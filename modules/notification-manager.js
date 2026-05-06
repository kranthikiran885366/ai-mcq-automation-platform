/**
 * Notification Manager Module
 * Handles all notifications: Chrome notifications, desktop notifications, and alerts
 */

class NotificationManager {
  constructor(config = {}) {
    this.config = {
      enableNotifications: config.enableNotifications !== false,
      enableSound: config.enableSound !== false,
      soundVolume: config.soundVolume || 0.7,
      notificationTimeout: config.notificationTimeout || 5000,
      position: config.position || 'bottom-right' // bottom-right, top-right, top-left, bottom-left
    };

    this.notificationHistory = [];
    this.maxHistorySize = 50;
    this.soundContext = null;
    this.notificationIds = new Map();
    this.initializeAudio();
  }

  /**
   * Initialize audio context for sound notifications
   */
  initializeAudio() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.soundContext = audioContext;
    } catch (error) {
      console.warn('[NotificationManager] Audio context not available:', error);
    }
  }

  /**
   * Show success notification
   */
  async showSuccess(title, message, options = {}) {
    return this.showNotification({
      type: 'success',
      title: title,
      message: message,
      icon: '✅',
      color: '#10b981',
      ...options
    });
  }

  /**
   * Show error notification
   */
  async showError(title, message, options = {}) {
    return this.showNotification({
      type: 'error',
      title: title,
      message: message,
      icon: '❌',
      color: '#ef4444',
      ...options
    });
  }

  /**
   * Show warning notification
   */
  async showWarning(title, message, options = {}) {
    return this.showNotification({
      type: 'warning',
      title: title,
      message: message,
      icon: '⚠️',
      color: '#f59e0b',
      ...options
    });
  }

  /**
   * Show info notification
   */
  async showInfo(title, message, options = {}) {
    return this.showNotification({
      type: 'info',
      title: title,
      message: message,
      icon: 'ℹ️',
      color: '#3b82f6',
      ...options
    });
  }

  /**
   * Show generic notification
   */
  async showNotification(options = {}) {
    const notification = {
      id: this.generateNotificationId(),
      type: options.type || 'info',
      title: options.title || 'Notification',
      message: options.message || '',
      icon: options.icon || 'ℹ️',
      color: options.color || '#3b82f6',
      timeout: options.timeout || this.config.notificationTimeout,
      actions: options.actions || [],
      timestamp: new Date().toISOString(),
      persistent: options.persistent || false
    };

    // Show Chrome extension notification
    if (this.config.enableNotifications) {
      this.showChromeNotification(notification);
    }

    // Show desktop notification
    if (options.desktop !== false && 'Notification' in window) {
      this.requestNotificationPermission().then(() => {
        this.showDesktopNotification(notification);
      });
    }

    // Play sound
    if (this.config.enableSound && options.sound !== false) {
      this.playNotificationSound(notification.type);
    }

    // Add to history
    this.notificationHistory.push(notification);
    if (this.notificationHistory.length > this.maxHistorySize) {
      this.notificationHistory.shift();
    }

    // Auto-dismiss if timeout > 0
    if (notification.timeout > 0 && !notification.persistent) {
      setTimeout(() => this.dismissNotification(notification.id), notification.timeout);
    }

    return notification;
  }

  /**
   * Show Chrome extension notification
   */
  showChromeNotification(notification) {
    chrome.notifications.create(notification.id, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: notification.title,
      message: notification.message,
      priority: this.getChromePriority(notification.type),
      buttons: notification.actions.map(action => ({
        title: action.label || action.title
      }))
    }, (notificationId) => {
      this.notificationIds.set(notificationId, notification);
    });

    // Listen for button clicks
    chrome.notifications.onButtonClicked.addListener((notifId, btnIndex) => {
      const notif = this.notificationIds.get(notifId);
      if (notif && notif.actions[btnIndex]) {
        const action = notif.actions[btnIndex];
        if (action.callback) {
          action.callback();
        }
      }
    });

    // Listen for notification close
    chrome.notifications.onClosed.addListener((notifId) => {
      this.notificationIds.delete(notifId);
    });
  }

  /**
   * Show desktop notification using Notification API
   */
  showDesktopNotification(notification) {
    try {
      const desktopNotif = new Notification(notification.title, {
        body: notification.message,
        icon: 'icons/icon128.png',
        tag: notification.id,
        badge: 'icons/icon48.png',
        requireInteraction: notification.persistent
      });

      desktopNotif.onclick = () => {
        window.focus();
        desktopNotif.close();
      };

      return desktopNotif;
    } catch (error) {
      console.warn('[NotificationManager] Desktop notification failed:', error);
    }
  }

  /**
   * Request notification permission
   */
  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      console.warn('[NotificationManager] Notifications not supported');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }

    return false;
  }

  /**
   * Play notification sound
   */
  playNotificationSound(type = 'info') {
    if (!this.config.enableSound || !this.soundContext) {
      return;
    }

    try {
      const oscillator = this.soundContext.createOscillator();
      const gainNode = this.soundContext.createGain();

      // Frequencies for different notification types
      const frequencies = {
        success: 600,
        error: 200,
        warning: 400,
        info: 500
      };

      const frequency = frequencies[type] || 500;

      oscillator.connect(gainNode);
      gainNode.connect(this.soundContext.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(this.config.soundVolume, this.soundContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        this.soundContext.currentTime + 0.5
      );

      oscillator.start(this.soundContext.currentTime);
      oscillator.stop(this.soundContext.currentTime + 0.5);
    } catch (error) {
      console.warn('[NotificationManager] Could not play sound:', error);
    }
  }

  /**
   * Show progress notification
   */
  showProgress(id, title, progress, total) {
    const percentage = ((progress / total) * 100).toFixed(1);
    const message = `${progress}/${total} (${percentage}%)`;

    return this.showNotification({
      id: id,
      type: 'info',
      title: title,
      message: message,
      persistent: true,
      timeout: 0
    });
  }

  /**
   * Show MCQ result notification
   */
  async showMCQResult(result) {
    const { correct, total, accuracy, ai_provider } = result;

    const title = correct === total ? '🎉 Perfect Score!' : '✅ Quiz Complete!';
    const message = `Accuracy: ${accuracy.toFixed(1)}% (${correct}/${total}\n Provider: ${ai_provider}`;

    return this.showSuccess(title, message, {
      timeout: 5000,
      actions: [
        { label: 'View Results', callback: () => this.openResults() },
        { label: 'Send to WhatsApp', callback: () => this.sendToWhatsApp(result) }
      ]
    });
  }

  /**
   * Show quiz session notification
   */
  async showSessionNotification(session) {
    const { total_mcqs, start_time, end_time } = session;
    const duration = (new Date(end_time) - new Date(start_time)) / 1000;

    const title = `Session Complete: ${total_mcqs} MCQs`;
    const message = `Duration: ${this.formatDuration(duration)}`;

    return this.showSuccess(title, message, {
      timeout: 5000,
      desktop: true
    });
  }

  /**
   * Dismiss notification
   */
  dismissNotification(notificationId) {
    chrome.notifications.clear(notificationId);
    this.notificationIds.delete(notificationId);
  }

  /**
   * Get Chrome notification priority
   */
  getChromePriority(type) {
    const priorities = {
      error: 2,
      warning: 1,
      success: 0,
      info: 0
    };
    return priorities[type] || 0;
  }

  /**
   * Generate notification ID
   */
  generateNotificationId() {
    return 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Format duration in seconds to readable format
   */
  formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    if (minutes === 0) {
      return `${secs}s`;
    }

    return `${minutes}m ${secs}s`;
  }

  /**
   * Get notification history
   */
  getHistory(filters = {}) {
    let history = this.notificationHistory;

    if (filters.type) {
      history = history.filter(n => n.type === filters.type);
    }

    if (filters.limit) {
      history = history.slice(-filters.limit);
    }

    return history;
  }

  /**
   * Clear notification history
   */
  clearHistory() {
    this.notificationHistory = [];
  }

  /**
   * Placeholder methods for integration
   */
  openResults() {
    console.log('[NotificationManager] Open results action');
  }

  sendToWhatsApp(result) {
    console.log('[NotificationManager] Send to WhatsApp action:', result);
    // TODO: Implement WhatsApp integration
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotificationManager;
}
