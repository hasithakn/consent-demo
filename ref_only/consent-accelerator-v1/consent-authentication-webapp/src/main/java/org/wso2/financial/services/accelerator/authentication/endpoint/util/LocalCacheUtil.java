/**
 * Copyright (c) 2024, WSO2 LLC. (https://www.wso2.com).
 * <p>
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 * <p>
 *     http://www.apache.org/licenses/LICENSE-2.0
 * <p>
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

package org.wso2.financial.services.accelerator.authentication.endpoint.util;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * A simple thread-safe local cache utility for storing objects with TTL (Time To Live).
 */
public class LocalCacheUtil {

    private static final Logger log = LoggerFactory.getLogger(LocalCacheUtil.class);
    
    // Singleton instance
    private static volatile LocalCacheUtil instance;
    
    // Cache storage with thread-safe map
    private final Map<String, CacheEntry> cache;
    
    // Default TTL in milliseconds (5 minutes)
    private static final long DEFAULT_TTL = TimeUnit.MINUTES.toMillis(5);
    
    /**
     * Private constructor for singleton pattern.
     */
    private LocalCacheUtil() {
        this.cache = new ConcurrentHashMap<>();
        // Start cleanup thread
        startCleanupThread();
    }
    
    /**
     * Get singleton instance of LocalCacheUtil.
     *
     * @return LocalCacheUtil instance
     */
    public static LocalCacheUtil getInstance() {
        if (instance == null) {
            synchronized (LocalCacheUtil.class) {
                if (instance == null) {
                    instance = new LocalCacheUtil();
                }
            }
        }
        return instance;
    }
    
    /**
     * Add an object to cache with default TTL.
     *
     * @param key   the cache key
     * @param value the object to cache
     */
    public void put(String key, Object value) {
        put(key, value, DEFAULT_TTL);
    }
    
    /**
     * Add an object to cache with custom TTL.
     *
     * @param key      the cache key
     * @param value    the object to cache
     * @param ttlMillis time to live in milliseconds
     */
    public void put(String key, Object value, long ttlMillis) {
        if (key == null || value == null) {
            log.warn("Cannot cache null key or value");
            return;
        }
        
        long expiryTime = System.currentTimeMillis() + ttlMillis;
        cache.put(key, new CacheEntry(value, expiryTime));
        log.debug("Cached object with key: {} (TTL: {} ms)", key, ttlMillis);
    }
    
    /**
     * Get an object from cache.
     *
     * @param key the cache key
     * @return the cached object, or null if not found or expired
     */
    public Object get(String key) {
        if (key == null) {
            return null;
        }
        
        CacheEntry entry = cache.get(key);
        
        if (entry == null) {
            log.debug("Cache miss for key: {}", key);
            return null;
        }
        
        // Check if expired
        if (entry.isExpired()) {
            log.debug("Cache entry expired for key: {}", key);
            cache.remove(key);
            return null;
        }
        
        log.debug("Cache hit for key: {}", key);
        return entry.getValue();
    }
    
    /**
     * Get an object from cache with type casting.
     *
     * @param key   the cache key
     * @param clazz the class type to cast to
     * @param <T>   the type parameter
     * @return the cached object cast to the specified type, or null if not found/expired/wrong type
     */
    @SuppressWarnings("unchecked")
    public <T> T get(String key, Class<T> clazz) {
        Object value = get(key);
        
        if (value == null) {
            return null;
        }
        
        try {
            return (T) value;
        } catch (ClassCastException e) {
            log.error("Failed to cast cached value for key: {} to type: {}", key, clazz.getName(), e);
            return null;
        }
    }
    
    /**
     * Remove an object from cache.
     *
     * @param key the cache key
     * @return the removed object, or null if not found
     */
    public Object remove(String key) {
        if (key == null) {
            return null;
        }
        
        CacheEntry entry = cache.remove(key);
        if (entry != null) {
            log.debug("Removed cache entry for key: {}", key);
            return entry.getValue();
        }
        return null;
    }
    
    /**
     * Check if a key exists in cache and is not expired.
     *
     * @param key the cache key
     * @return true if key exists and is not expired, false otherwise
     */
    public boolean containsKey(String key) {
        if (key == null) {
            return false;
        }
        
        CacheEntry entry = cache.get(key);
        if (entry == null || entry.isExpired()) {
            if (entry != null && entry.isExpired()) {
                cache.remove(key);
            }
            return false;
        }
        return true;
    }
    
    /**
     * Clear all entries from cache.
     */
    public void clear() {
        cache.clear();
        log.info("Cache cleared");
    }
    
    /**
     * Get the current size of the cache.
     *
     * @return number of entries in cache
     */
    public int size() {
        return cache.size();
    }
    
    /**
     * Start a background thread to clean up expired entries.
     */
    private void startCleanupThread() {
        Thread cleanupThread = new Thread(() -> {
            while (true) {
                try {
                    // Run cleanup every minute
                    Thread.sleep(TimeUnit.MINUTES.toMillis(1));
                    cleanupExpiredEntries();
                } catch (InterruptedException e) {
                    log.warn("Cache cleanup thread interrupted", e);
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        });
        
        cleanupThread.setDaemon(true);
        cleanupThread.setName("LocalCache-Cleanup-Thread");
        cleanupThread.start();
        log.info("Cache cleanup thread started");
    }
    
    /**
     * Remove all expired entries from cache.
     */
    private void cleanupExpiredEntries() {
        int removedCount = 0;
        for (Map.Entry<String, CacheEntry> entry : cache.entrySet()) {
            if (entry.getValue().isExpired()) {
                cache.remove(entry.getKey());
                removedCount++;
            }
        }
        
        if (removedCount > 0) {
            log.debug("Cleaned up {} expired cache entries", removedCount);
        }
    }
    
    /**
     * Internal class to hold cached values with expiry time.
     */
    private static class CacheEntry {
        private final Object value;
        private final long expiryTime;
        
        public CacheEntry(Object value, long expiryTime) {
            this.value = value;
            this.expiryTime = expiryTime;
        }
        
        public Object getValue() {
            return value;
        }
        
        public boolean isExpired() {
            return System.currentTimeMillis() > expiryTime;
        }
    }
}
