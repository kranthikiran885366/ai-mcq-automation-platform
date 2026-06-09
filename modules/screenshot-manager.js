/**
 * Screenshot Manager Module
 * Handles all screenshot capture, storage, and management
 * Features: Capture, compress, save, export, and manage screenshots
 */

class ScreenshotManager {
  constructor() {
    this.screenshots = [];
    this.maxStorageSize = 50 * 1024 * 1024; // 50MB limit
    this.currentStorageSize = 0;
    this.compressionQuality = 0.8; // 80% quality for compression
    this.initStorage();
  }

  /**
   * Initialize storage and load existing screenshots
   */
  async initStorage() {
    try {
      const stored = await this.getFromIndexedDB('screenshots');
      if (stored) {
        this.screenshots = stored;
        this.calculateStorageSize();
      }
    } catch (error) {
      console.error('[ScreenshotManager] Error initializing storage:', error);
    }
  }

  /**
   * Capture current tab with metadata
   */
  async captureTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve({
          success: true,
          dataUrl: dataUrl,
          timestamp: new Date().toISOString(),
          size: this.estimateDataUrlSize(dataUrl)
        });
      });
    });
  }

  /**
   * Capture with full metadata
   */
  async captureWithMetadata(metadata = {}) {
    try {
      const screenshotData = await this.captureTab();
      
      const screenshot = {
        id: this.generateId(),
        dataUrl: screenshotData.dataUrl,
        timestamp: screenshotData.timestamp,
        size: screenshotData.size,
        url: metadata.url || '',
        questionNumber: metadata.questionNumber || 0,
        questionText: metadata.questionText || '',
        selectedAnswer: metadata.selectedAnswer || '',
        accuracy: metadata.accuracy || 0,
        ai_provider: metadata.ai_provider || '',
        sessionId: metadata.sessionId || '',
        compressed: false,
        metadata: metadata
      };

      // Compress if needed
      if (screenshot.size > 500 * 1024) { // Compress if larger than 500KB
        screenshot.dataUrl = await this.compressImage(screenshot.dataUrl);
        screenshot.compressed = true;
        screenshot.size = this.estimateDataUrlSize(screenshot.dataUrl);
      }

      // Check storage quota
      if (this.currentStorageSize + screenshot.size > this.maxStorageSize) {
        await this.cleanupOldScreenshots();
      }

      // Save to IndexedDB
      this.screenshots.push(screenshot);
      await this.saveToIndexedDB('screenshots', this.screenshots);
      this.currentStorageSize += screenshot.size;

      console.log('[ScreenshotManager] Screenshot saved:', screenshot.id);
      return { success: true, screenshot: screenshot };
    } catch (error) {
      console.error('[ScreenshotManager] Capture failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Compress image using Canvas API
   */
  async compressImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width * 0.8; // Reduce size by 20%
        canvas.height = img.height * 0.8;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const compressed = canvas.toDataURL('image/jpeg', this.compressionQuality);
        resolve(compressed);
      };

      img.onerror = () => reject(new Error('Image compression failed'));
      img.src = dataUrl;
    });
  }

  /**
   * Get all screenshots
   */
  async getAllScreenshots(filters = {}) {
    let results = this.screenshots;

    if (filters.sessionId) {
      results = results.filter(s => s.sessionId === filters.sessionId);
    }

    if (filters.startDate) {
      results = results.filter(s => new Date(s.timestamp) >= new Date(filters.startDate));
    }

    if (filters.endDate) {
      results = results.filter(s => new Date(s.timestamp) <= new Date(filters.endDate));
    }

    return results;
  }

  /**
   * Download screenshot as file
   */
  async downloadScreenshot(screenshotId) {
    const screenshot = this.screenshots.find(s => s.id === screenshotId);
    if (!screenshot) {
      return { success: false, error: 'Screenshot not found' };
    }

    try {
      const link = document.createElement('a');
      link.href = screenshot.dataUrl;
      link.download = `screenshot-${screenshot.id}.png`;
      link.click();

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Export screenshots as ZIP
   */
  async exportAsZip(screenshotIds) {
    // Requires jszip library
    console.log('[ScreenshotManager] ZIP export requires jszip library');
    return { success: false, error: 'ZIP export not implemented' };
  }

  /**
   * Delete screenshot
   */
  async deleteScreenshot(screenshotId) {
    const index = this.screenshots.findIndex(s => s.id === screenshotId);
    if (index === -1) {
      return { success: false, error: 'Screenshot not found' };
    }

    const screenshot = this.screenshots[index];
    this.screenshots.splice(index, 1);
    this.currentStorageSize -= screenshot.size;

    await this.saveToIndexedDB('screenshots', this.screenshots);
    return { success: true };
  }

  /**
   * Clean up old screenshots when storage limit exceeded
   */
  async cleanupOldScreenshots() {
    // Delete screenshots older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const toDelete = this.screenshots.filter(s => 
      new Date(s.timestamp) < thirtyDaysAgo
    );

    for (const screenshot of toDelete) {
      await this.deleteScreenshot(screenshot.id);
    }

    console.log(`[ScreenshotManager] Deleted ${toDelete.length} old screenshots`);
  }

  /**
   * Get storage usage
   */
  getStorageUsage() {
    const totalSize = this.screenshots.reduce((sum, s) => sum + s.size, 0);
    return {
      used: totalSize,
      total: this.maxStorageSize,
      percentage: (totalSize / this.maxStorageSize * 100).toFixed(2),
      screenshotCount: this.screenshots.length
    };
  }

  /**
   * IndexedDB operations
   */
  async saveToIndexedDB(storeName, data) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('MCQBot', 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        store.put(data, 'data');

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getFromIndexedDB(storeName) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('MCQBot', 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const getRequest = store.get('data');

        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => reject(getRequest.error);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Helper methods
   */
  generateId() {
    return 'ss_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  estimateDataUrlSize(dataUrl) {
    // Data URL format: "data:image/png;base64,..." 
    // The base64 part is roughly 4/3 of the actual binary size
    const base64 = dataUrl.split(',')[1];
    return Math.ceil((base64.length * 3) / 4);
  }

  calculateStorageSize() {
    this.currentStorageSize = this.screenshots.reduce((sum, s) => sum + s.size, 0);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScreenshotManager;
}
