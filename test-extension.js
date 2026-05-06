/**
 * Extension Test Harness
 * Run this in the extension console (F12) to verify all modules work
 */

console.log('🧪 === EXTENSION TEST HARNESS ===');
console.log('Testing all modules and functionality...\n');

// Global test results
const testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

// Test utility
function assert(condition, testName) {
  if (condition) {
    console.log(`✓ ${testName}`);
    testResults.passed++;
  } else {
    console.error(`✗ ${testName}`);
    testResults.failed++;
    testResults.errors.push(testName);
  }
}

// ============================================================================
// TEST 1: Module Availability
// ============================================================================

console.log('📦 TEST 1: Module Availability\n');

assert(typeof StorageManager !== 'undefined', 'StorageManager is available');
assert(typeof WhatsAppManager !== 'undefined', 'WhatsAppManager is available');
assert(typeof ScreenshotManager !== 'undefined', 'ScreenshotManager is available');
assert(typeof AutoAnswerManager !== 'undefined', 'AutoAnswerManager is available');
assert(typeof MCQOrchestrator !== 'undefined', 'MCQOrchestrator is available');
assert(typeof MCQDetector !== 'undefined', 'MCQDetector is available');
assert(typeof MCQAutomationSystem !== 'undefined', 'MCQAutomationSystem is available');
assert(typeof UIDatabase !== 'undefined', 'UIDatabase is available');

console.log();

// ============================================================================
// TEST 2: Class Instantiation
// ============================================================================

console.log('⚙️ TEST 2: Class Instantiation\n');

try {
  const storage = new StorageManager();
  assert(storage !== null, 'StorageManager instantiation');
} catch (e) {
  console.error('Error instantiating StorageManager:', e.message);
  testResults.failed++;
}

try {
  const detector = new MCQDetector();
  assert(detector !== null, 'MCQDetector instantiation');
  assert(detector.patterns !== undefined, 'MCQDetector has patterns');
} catch (e) {
  console.error('Error instantiating MCQDetector:', e.message);
  testResults.failed++;
}

try {
  const system = new MCQAutomationSystem();
  assert(system !== null, 'MCQAutomationSystem instantiation');
} catch (e) {
  console.error('Error instantiating MCQAutomationSystem:', e.message);
  testResults.failed++;
}

console.log();

// ============================================================================
// TEST 3: Global Variables
// ============================================================================

console.log('🌍 TEST 3: Global Variables\n');

assert(typeof automationSystem !== 'undefined', 'automationSystem is defined');
assert(typeof mcqDetector !== 'undefined', 'mcqDetector is defined');
assert(typeof isInitialized !== 'undefined', 'isInitialized is defined');

console.log();

// ============================================================================
// TEST 4: DOM Detection
// ============================================================================

console.log('🔍 TEST 4: DOM Detection\n');

if (mcqDetector) {
  try {
    const mcqs = mcqDetector.detectMCQs();
    console.log(`Found ${mcqs.length} MCQs on page`);
    assert(Array.isArray(mcqs), 'detectMCQs returns array');
  } catch (e) {
    console.error('Error in detectMCQs:', e.message);
    testResults.failed++;
  }
}

console.log();

// ============================================================================
// TEST 5: Event System
// ============================================================================

console.log('📡 TEST 5: Event System\n');

if (automationSystem) {
  try {
    let eventFired = false;
    
    automationSystem.on('test', () => {
      eventFired = true;
    });
    
    automationSystem.emit('test');
    assert(eventFired, 'Event system works');
  } catch (e) {
    console.error('Error testing event system:', e.message);
    testResults.failed++;
  }
}

console.log();

// ============================================================================
// TEST 6: Storage API
// ============================================================================

console.log('💾 TEST 6: Storage API\n');

try {
  const storage = new StorageManager();
  
  // Mock init without actual DB
  assert(typeof storage.init === 'function', 'StorageManager has init method');
  assert(typeof storage.createConversation === 'function', 'StorageManager has createConversation method');
  assert(typeof storage.addMessage === 'function', 'StorageManager has addMessage method');
} catch (e) {
  console.error('Error testing storage:', e.message);
  testResults.failed++;
}

console.log();

// ============================================================================
// TEST 7: UI Elements
// ============================================================================

console.log('🎨 TEST 7: UI Elements\n');

// Check for floating button
const floatingButton = document.querySelector('[data-mcq-button]');
assert(floatingButton !== null, 'Floating button exists in DOM');

// Check for dashboard
const dashboard = document.querySelector('[data-mcq-dashboard]');
assert(dashboard !== null, 'Dashboard exists in DOM');

console.log();

// ============================================================================
// TEST 8: MCQ Detection Patterns
// ============================================================================

console.log('🎯 TEST 8: MCQ Detection Patterns\n');

if (mcqDetector && mcqDetector.patterns) {
  const patternCount = (mcqDetector.patterns.selectors || []).length;
  console.log(`MCQDetector has ${patternCount} selector patterns`);
  assert(patternCount >= 40, 'MCQDetector has 40+ selector patterns');
}

console.log();

// ============================================================================
// TEST 9: Auto-Answer Strategies
// ============================================================================

console.log('🤖 TEST 9: Auto-Answer Strategies\n');

try {
  const autoAnswer = new AutoAnswerManager();
  assert(typeof autoAnswer.findAnswerOptionAdvanced === 'function', 'Advanced selector available');
  assert(typeof autoAnswer.selectAnswer === 'function', 'selectAnswer method available');
  assert(typeof autoAnswer.applyAnswersWithProgress === 'function', 'Batch apply available');
  assert(typeof autoAnswer.getSelectionReport === 'function', 'Report generation available');
} catch (e) {
  console.error('Error testing auto-answer:', e.message);
  testResults.failed++;
}

console.log();

// ============================================================================
// TEST 10: Message Parsing
// ============================================================================

console.log('📨 TEST 10: Message Parsing\n');

try {
  const whatsapp = new WhatsAppManager();
  const testMessage = 'Q1: A\nQ2: B\nQ3: C';
  const parsed = whatsapp.parseAnswers(testMessage);
  
  assert(Array.isArray(parsed), 'parseAnswers returns array');
  assert(parsed.length === 3, 'Parsed 3 answers correctly');
  assert(parsed[0].answer === 'A', 'First answer is A');
  assert(parsed[1].answer === 'B', 'Second answer is B');
  assert(parsed[2].answer === 'C', 'Third answer is C');
} catch (e) {
  console.error('Error testing message parsing:', e.message);
  testResults.failed++;
}

console.log();

// ============================================================================
// SUMMARY
// ============================================================================

console.log('📊 === TEST SUMMARY ===\n');
console.log(`✓ Passed: ${testResults.passed}`);
console.log(`✗ Failed: ${testResults.failed}`);
console.log(`Total: ${testResults.passed + testResults.failed}\n`);

if (testResults.failed === 0) {
  console.log('🎉 ALL TESTS PASSED!\n');
  console.log('Extension is ready for use:');
  console.log('1. Go to any MCQ website');
  console.log('2. Click the floating button (📸)');
  console.log('3. Take a screenshot');
  console.log('4. Reply on WhatsApp with answers');
  console.log('5. Watch answers auto-select!');
} else {
  console.log('⚠️ SOME TESTS FAILED:\n');
  testResults.errors.forEach(error => console.log(`  - ${error}`));
  console.log('\nCheck the console for error details.');
}

console.log('\n=== END OF TEST HARNESS ===\n');

// Export results for programmatic access
window.extensionTestResults = testResults;
