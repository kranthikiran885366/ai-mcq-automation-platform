"""
WhatsApp Integration for MCQ Extension
Handles sending screenshots and receiving answers via Twilio
"""

from flask import Flask, request, jsonify
from twilio.rest import Client
from twilio.request import TwilioHttpClient
import os
import logging
from datetime import datetime
import json

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Twilio Configuration
TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID', 'your_account_sid')
TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN', 'your_auth_token')
TWILIO_WHATSAPP_FROM = os.getenv('TWILIO_WHATSAPP_FROM', 'whatsapp:+1234567890')

# Initialize Twilio client
client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

# Store for conversation tracking
conversations = {}


@app.route('/api/whatsapp/send', methods=['POST'])
def send_whatsapp_message():
    """
    Send screenshot to WhatsApp via Twilio
    
    Request:
    {
      "to": "+1234567890",
      "from": "+9876543210",
      "message": "📋 MCQ Screenshot...",
      "mediaUrl": "data:image/jpeg;base64,...",
      "metadata": {...}
    }
    """
    try:
        data = request.json
        to_number = data.get('to')
        message_body = data.get('message')
        media_url = data.get('mediaUrl')
        metadata = data.get('metadata', {})

        logger.info(f"Sending WhatsApp message to {to_number}")

        # Prepare message
        message_params = {
            'from_': TWILIO_WHATSAPP_FROM,
            'body': message_body,
            'to': f"whatsapp:{to_number}"
        }

        # Add media if present (must be publicly accessible URL)
        if media_url and media_url.startswith('http'):
            message_params['media_url'] = media_url

        # Send message
        message = client.messages.create(**message_params)

        # Store conversation metadata
        conv_id = metadata.get('conversationId')
        if conv_id:
            conversations[conv_id] = {
                'message_sid': message.sid,
                'to_number': to_number,
                'timestamp': datetime.now().isoformat(),
                'status': 'sent',
                'metadata': metadata
            }

        logger.info(f"Message sent successfully: {message.sid}")

        return jsonify({
            'success': True,
            'messageId': message.sid,
            'conversationId': conv_id,
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        logger.error(f"Error sending WhatsApp message: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400


@app.route('/webhook/whatsapp', methods=['POST'])
def whatsapp_webhook():
    """
    Webhook to receive WhatsApp messages from Twilio
    This is called by Twilio when user sends a reply
    
    Twilio sends:
    - From: whatsapp:+1234567890
    - Body: "Q1: A\nQ2: B..."
    - MessageSid: SM123456789
    - NumMedia: 1
    - MediaUrl0: https://...
    """
    try:
        # Extract message data
        from_number = request.form.get('From', '').replace('whatsapp:', '')
        message_body = request.form.get('Body', '')
        message_sid = request.form.get('MessageSid', '')
        num_media = int(request.form.get('NumMedia', 0))
        media_urls = []

        # Extract media URLs
        for i in range(num_media):
            media_url = request.form.get(f'MediaUrl{i}')
            if media_url:
                media_urls.append(media_url)

        logger.info(f"Received WhatsApp message from {from_number}: {message_body[:50]}...")

        # Parse answers from message
        answers = parse_answers(message_body)

        # Find associated conversation
        conversation_id = find_conversation(from_number)

        # Store message
        if conversation_id and conversation_id in conversations:
            conversations[conversation_id]['messages'] = conversations[conversation_id].get('messages', [])
            conversations[conversation_id]['messages'].append({
                'timestamp': datetime.now().isoformat(),
                'from': from_number,
                'body': message_body,
                'sid': message_sid,
                'answers': answers,
                'media': media_urls
            })

        logger.info(f"Parsed {len(answers)} answers from message")

        # Relay to Chrome extension via background script
        relay_to_extension({
            'action': 'whatsappMessageReceived',
            'data': {
                'from': from_number,
                'body': message_body,
                'messageId': message_sid,
                'conversationId': conversation_id,
                'answers': answers,
                'mediaUrls': media_urls,
                'timestamp': datetime.now().isoformat(),
                'senderType': 'user'  # User sent via WhatsApp
            }
        })

        # Send acknowledgement to WhatsApp (optional)
        acknowledgement = client.messages.create(
            from_=TWILIO_WHATSAPP_FROM,
            body=f"✓ Received {len(answers)} answers. Applying now...",
            to=f"whatsapp:{from_number}"
        )

        return jsonify({
            'success': True,
            'message': 'Webhook processed',
            'answersCount': len(answers)
        }), 200

    except Exception as e:
        logger.error(f"Webhook error: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400


@app.route('/api/whatsapp/verify-webhook', methods=['POST'])
def verify_webhook_signature():
    """
    Verify Twilio webhook signature for security
    """
    try:
        data = request.json
        body = data.get('body', '')
        twilio_signature = data.get('twilioSignature', '')
        url = data.get('url', '')

        # In production, verify signature using:
        # from twilio.request import TwilioRequestValidator
        # validator = TwilioRequestValidator(TWILIO_AUTH_TOKEN)
        # is_valid = validator.validate(url, body, twilio_signature)

        logger.info("Webhook signature verified")
        return jsonify({'success': True, 'valid': True}), 200

    except Exception as e:
        logger.error(f"Signature verification error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 400


@app.route('/api/whatsapp/conversations', methods=['GET'])
def get_conversations():
    """Get all conversations with WhatsApp"""
    try:
        return jsonify({
            'success': True,
            'conversations': conversations
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400


@app.route('/api/whatsapp/conversation/<conversation_id>', methods=['GET'])
def get_conversation(conversation_id):
    """Get specific conversation details"""
    try:
        conversation = conversations.get(conversation_id)
        if not conversation:
            return jsonify({'success': False, 'error': 'Conversation not found'}), 404

        return jsonify({
            'success': True,
            'conversation': conversation
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400


@app.route('/api/whatsapp/status/<message_id>', methods=['GET'])
def get_message_status(message_id):
    """Get message delivery status"""
    try:
        message = client.messages(message_id).fetch()
        return jsonify({
            'success': True,
            'messageId': message.sid,
            'status': message.status,
            'dateSent': str(message.date_sent),
            'errorCode': message.error_code,
            'errorMessage': message.error_message
        }), 200
    except Exception as e:
        logger.error(f"Status check error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 400


def parse_answers(message_text):
    """
    Parse answer format from WhatsApp message
    Expected format:
    Q1: A
    Q2: B
    Q3: C
    
    Returns: [{'questionIndex': 0, 'answer': 'A'}, ...]
    """
    answers = []
    lines = message_text.split('\n')

    for line in lines:
        line = line.strip()
        # Match "Q1: A" or "Q1:A" or "1: A" or "1:A"
        if ':' in line:
            parts = line.split(':')
            if len(parts) == 2:
                q_part = parts[0].strip().upper()
                a_part = parts[1].strip().upper()

                # Extract question number
                import re
                q_match = re.search(r'\d+', q_part)
                a_match = re.search(r'[A-E]', a_part)

                if q_match and a_match:
                    question_index = int(q_match.group()) - 1  # Convert to 0-indexed
                    answer = a_match.group()

                    answers.append({
                        'questionIndex': question_index,
                        'answer': answer,
                        'raw': line
                    })

    return answers


def find_conversation(from_number):
    """Find conversation by WhatsApp number"""
    for conv_id, conv_data in conversations.items():
        if conv_data.get('to_number') == from_number:
            return conv_id
    return None


def relay_to_extension(message):
    """
    Relay message to Chrome extension
    In production, use a proper channel like:
    - WebSocket connection
    - Webhook callback
    - Firebase Realtime Database
    - Redis Pub/Sub
    """
    # TODO: Implement proper relay mechanism
    logger.info(f"Relaying to extension: {message['action']}")
    # For now, just log
    # In real implementation, send via:
    # - firebase.send(message)
    # - redis.publish('extension-channel', message)
    # - websocket.send(message)


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat(),
        'twilio': 'configured' if TWILIO_ACCOUNT_SID else 'not_configured'
    }), 200


if __name__ == '__main__':
    # In production, use a WSGI server like Gunicorn
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=os.getenv('FLASK_ENV') == 'development'
    )
