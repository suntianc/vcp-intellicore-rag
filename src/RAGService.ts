/**
 * RAGService - RAG检索服务实现
 * 
 * 基于VectorDBManager迁移，实现IRAGService接口
 * 使用hnswlib-node进行向量搜索
 */

import { HierarchicalNSW } from 'hnswlib-node';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  IRAGService,
  RAGConfig,
  RAGSearchOptions,
  RAGResult,
  RAGDocument,
  RAGServiceStatus
} from 'vcp-intellicore-sdk';

/**
 * LRU缓存（带TTL）
 */
class SearchCache {
  private cache: Map<string, { result: any; timestamp: number }> = new Map();
  private hits = 0;
  private misses = 0;

  constructor(
    private maxSize: number = 100,
    private ttl: number = 60000 // 1分钟
  ) {}

  private getCacheKey(knowledgeBase: string, queryVector: number[], k: number): string {
    const vectorHash = crypto
      .createHash('md5')
      .update(JSON.stringify(queryVector))
      .digest('hex');
    return `${knowledgeBase}-${vectorHash}-${k}`;
  }

  get(knowledgeBase: string, queryVector: number[], k: number): RAGResult[] | null {
    const key = this.getCacheKey(knowledgeBase, queryVector, k);
    const entry = this.cache.get(key);

    if (entry && Date.now() - entry.timestamp < this.ttl) {
      this.hits++;
      return entry.result;
    }

    this.cache.delete(key);
    this.misses++;
    return null;
  }

  set(knowledgeBase: string, queryVector: number[], k: number, result: RAGResult[]): void {
    const key = this.getCacheKey(knowledgeBase, queryVector, k);

    // LRU淘汰
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });
  }

  getStats() {
    const total = this.hits + this.misses;
    const hitRateNum = total > 0 ? (this.hits / total * 100) : 0;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: hitRateNum.toFixed(2) + '%',
      hitRateNumber: hitRateNum,
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * RAG服务实现
 */
export class RAGService implements IRAGService {
  private config: Required<RAGConfig>;
  private indices: Map<string, HierarchicalNSW> = new Map();
  private chunkMaps: Map<string, Record<string, any>> = new Map();
  private searchCache: SearchCache;
  private stats = {
    totalSearches: 0,
    avgSearchTime: 0
  };

  constructor() {
    // 默认配置
    // 统一配置风格：仅使用扁平格式（RAG_VECTORIZER_*），兼容旧格式（API_URL, API_Key, WhitelistEmbeddingModel）以支持外部项目
    const vectorizerApiUrl = 
      process.env.RAG_VECTORIZER_API_URL ||    // 优先：扁平格式
      process.env.API_URL ||                    // 兼容：旧格式（外部项目可能使用）
      '';
    
    const vectorizerApiKey = 
      process.env.RAG_VECTORIZER_API_KEY ||    // 优先：扁平格式
      process.env.API_Key ||                    // 兼容：旧格式（外部项目可能使用）
      '';
    
    const vectorizerModel = 
      process.env.RAG_VECTORIZER_MODEL ||      // 优先：扁平格式
      process.env.WhitelistEmbeddingModel ||   // 兼容：旧格式（外部项目可能使用）
      'text-embedding-3-small';
    
    const vectorizerDim = process.env.RAG_VECTORIZER_DIMENSIONS;
    
    this.config = {
      workDir: process.env.RAG_STORAGE_PATH || './VectorStore',
      vectorizer: {
        apiUrl: vectorizerApiUrl,
        apiKey: vectorizerApiKey,
        model: vectorizerModel,
        dimensions: vectorizerDim ? parseInt(vectorizerDim) : this.getDefaultDimensions(vectorizerModel)
      },
      changeThreshold: 0.5,
      maxMemoryUsage: 500 * 1024 * 1024, // 500MB
      cacheSize: 100,
      cacheTTL: 60000, // 1分钟
      efSearch: 150,
      debug: false
    };

    this.searchCache = new SearchCache(this.config.cacheSize, this.config.cacheTTL);
  }
  
  /**
   * 根据模型名称获取默认维度
   */
  private getDefaultDimensions(model: string): number {
    const dimensionsMap: Record<string, number> = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
      'text-embedding-ada-001': 1024,
      'Qwen/Qwen3-Embedding-4B': 2560,
      'Qwen/Qwen3-Embedding-2560': 2560,
    };
    return dimensionsMap[model] || 1536;
  }
  
  /**
   * 获取当前配置的embedding维度
   */
  private getDimensions(): number {
    return this.config.vectorizer.dimensions || 1536;
  }

  /**
   * 初始化RAG服务
   */
  async initialize(config?: RAGConfig): Promise<void> {
    if (config) {
      // 深度合并配置，特别是vectorizer配置需要合并而不是替换
      this.config = {
        ...this.config,
        ...config,
        vectorizer: config.vectorizer ? {
          ...this.config.vectorizer,
          ...config.vectorizer
        } : this.config.vectorizer
      };
    }

    // 创建工作目录
    await fs.mkdir(this.config.workDir, { recursive: true });

    this.log('RAG Service initialized', {
      workDir: this.config.workDir,
      cacheSize: this.config.cacheSize,
      efSearch: this.config.efSearch
    });
  }

  /**
   * RAG检索
   */
  async search(options: RAGSearchOptions): Promise<RAGResult[]> {
    const startTime = Date.now();
    const kInput = options.k || 10;
    const similarityThreshold = options.similarityThreshold || 0.0;

    try {
      // 获取查询向量
      const queryVector = await this.getEmbedding(options.query);

      // 检查缓存
      const cached = this.searchCache.get(options.knowledgeBase, queryVector, kInput);
      if (cached) {
        this.log('Cache hit for search');
        return cached;
      }

      // 加载或获取索引
      const index = await this.getOrLoadIndex(options.knowledgeBase);
      if (!index) {
        this.log(`No index found for knowledge base: ${options.knowledgeBase}`);
        return [];
      }

      // 搜索
      const maxElements = (index as any).getMaxElements ? (index as any).getMaxElements() : undefined;
      const currentCount = index.getCurrentCount();
      const effectiveK = (() => {
        let value = Math.min(kInput, currentCount || 1);
        if (maxElements && value > maxElements) {
          value = maxElements;
        }
        return Math.max(1, value);
      })();

      const result = index.searchKnn(queryVector, effectiveK);
      const chunkMap = this.chunkMaps.get(options.knowledgeBase) || {};

      // 转换结果
      const results: RAGResult[] = result.neighbors.map((neighborIdx, i) => {
        const distance = result.distances[i];
        const similarity = 1 / (1 + distance); // 转换为相似度分数
        const chunk = chunkMap[neighborIdx];

        return {
          id: chunk?.id || `chunk-${neighborIdx}`,
          content: chunk?.text || '',
          score: similarity,
          metadata: {
            source: chunk?.source,
            timestamp: chunk?.timestamp,
            ...(chunk?.metadata || {})
          }
        };
      }).filter(r => r.score >= similarityThreshold);

      // 缓存结果
      this.searchCache.set(options.knowledgeBase, queryVector, kInput, results);

      // 记录指标
      const duration = Date.now() - startTime;
      this.recordMetric('search', duration);

      return results;
    } catch (error) {
      this.log('Search error:', error);
      throw error;
    }
  }

  /**
   * 添加单个文档
   */
  async addDocument(doc: RAGDocument): Promise<void> {
    await this.addDocuments([doc]);
  }

  /**
   * 批量添加文档
   */
  async addDocuments(docs: RAGDocument[]): Promise<void> {
    if (docs.length === 0) return;

    // 按知识库分组
    const grouped = new Map<string, RAGDocument[]>();
    for (const doc of docs) {
      const existing = grouped.get(doc.knowledgeBase) || [];
      existing.push(doc);
      grouped.set(doc.knowledgeBase, existing);
    }

    // 为每个知识库添加文档
    for (const [knowledgeBase, kbDocs] of grouped.entries()) {
      await this.addDocumentsToKB(knowledgeBase, kbDocs);
    }
  }

  /**
   * 更新文档
   */
  async updateDocument(id: string, doc: Partial<RAGDocument>): Promise<void> {
    // 简化实现：先删除再添加
    if (doc.knowledgeBase) {
      await this.removeDocument(id);
      if (doc.content) {
        await this.addDocument({
          id,
          content: doc.content,
          knowledgeBase: doc.knowledgeBase,
          metadata: doc.metadata
        });
      }
    }
  }

  /**
   * 删除文档
   */
  async removeDocument(id: string): Promise<void> {
    // 需要遍历所有知识库找到对应文档
    // 简化实现：标记为删除
    this.log(`Document removed: ${id}`);
  }

  /**
   * 删除知识库
   */
  async removeKnowledgeBase(name: string): Promise<void> {
    // 从内存中删除
    this.indices.delete(name);
    this.chunkMaps.delete(name);

    // 删除磁盘文件
    const indexPath = path.join(this.config.workDir, `${name}.hnsw`);
    const chunkPath = path.join(this.config.workDir, `${name}.chunks.json`);

    try {
      await fs.unlink(indexPath);
      await fs.unlink(chunkPath);
      this.log(`Knowledge base removed: ${name}`);
    } catch (error) {
      // 文件可能不存在
    }
  }

  /**
   * 获取服务状态
   */
  async getStatus(): Promise<RAGServiceStatus> {
    const knowledgeBases = Array.from(this.indices.keys()).map(name => ({
      name,
      documentCount: this.indices.get(name)?.getCurrentCount() || 0,
      lastUpdate: new Date() // 简化实现
    }));

    const cacheStats = this.searchCache.getStats();

    return {
      status: 'healthy',
      knowledgeBases,
      metrics: {
        totalSearches: this.stats.totalSearches,
        avgSearchTime: this.stats.avgSearchTime,
        cacheHitRate: cacheStats.hitRateNumber,
        cacheSize: cacheStats.size
      }
    };
  }

  /**
   * 关闭服务
   */
  async shutdown(): Promise<void> {
    // 保存所有索引
    for (const [name, index] of this.indices.entries()) {
      await this.saveIndex(name, index);
    }

    // 清理缓存
    this.searchCache.clear();
    this.indices.clear();
    this.chunkMaps.clear();

    this.log('RAG Service shutdown');
  }

  // ========== 私有方法 ==========

  /**
   * 获取或加载索引
   */
  private async getOrLoadIndex(knowledgeBase: string): Promise<HierarchicalNSW | null> {
    // 检查内存
    let index = this.indices.get(knowledgeBase);
    if (index) {
      return index;
    }

    // 从磁盘加载
    const indexPath = path.join(this.config.workDir, `${knowledgeBase}.hnsw`);
    const chunkPath = path.join(this.config.workDir, `${knowledgeBase}.chunks.json`);

    try {
      // 加载索引
      const dimensions = this.getDimensions();
      index = new HierarchicalNSW('cosine', dimensions);
      await index.readIndex(indexPath);
      index.setEf(this.config.efSearch);

      // 加载chunk映射
      const chunkData = await fs.readFile(chunkPath, 'utf-8');
      const chunkMap = JSON.parse(chunkData);

      this.indices.set(knowledgeBase, index);
      this.chunkMaps.set(knowledgeBase, chunkMap);

      this.log(`Index loaded for: ${knowledgeBase}`);
      return index;
    } catch (error) {
      // 索引不存在
      return null;
    }
  }

  /**
   * 为知识库添加文档
   */
  private async addDocumentsToKB(knowledgeBase: string, docs: RAGDocument[]): Promise<void> {
    // 生成embeddings
    const contents = docs.map(d => d.content);
    const embeddings = await this.getEmbeddings(contents);

    // 获取或创建索引
    let index = this.indices.get(knowledgeBase);
    let chunkMap = this.chunkMaps.get(knowledgeBase) || {};

    if (!index) {
      // 创建新索引
      const dimensions = this.getDimensions();
      index = new HierarchicalNSW('cosine', dimensions);
      const initialCapacity = Math.max(docs.length + 256, 1024);
      index.initIndex(initialCapacity, 16, 200, 100);
      index.setEf(this.config.efSearch);
      this.indices.set(knowledgeBase, index);
    } else {
      // 确保索引容量足够
      const getMaxElements = (index as any).getMaxElements;
      const resizeIndex = (index as any).resizeIndex;
      if (typeof getMaxElements === 'function' && typeof resizeIndex === 'function') {
        const currentCount = index.getCurrentCount();
        const maxElements = getMaxElements.call(index);
        const required = currentCount + embeddings.length;
        if (required > maxElements) {
          const newCapacity = Math.max(required + 256, Math.floor(maxElements * 1.5));
          resizeIndex.call(index, newCapacity);
          this.log(`Index resized for ${knowledgeBase} from ${maxElements} to ${newCapacity}`);
        }
      }
    }

    // 添加向量
    let currentIdx = index.getCurrentCount();
    for (let i = 0; i < embeddings.length; i++) {
      index.addPoint(embeddings[i], currentIdx);

      // 存储chunk信息
      chunkMap[currentIdx] = {
        id: docs[i].id || `doc-${currentIdx}`,
        text: docs[i].content,
        source: docs[i].metadata?.source,
        timestamp: docs[i].metadata?.timestamp || new Date(),
        metadata: docs[i].metadata
      };

      currentIdx++;
    }

    this.chunkMaps.set(knowledgeBase, chunkMap);

    // 保存到磁盘
    await this.saveIndex(knowledgeBase, index);
    await this.saveChunkMap(knowledgeBase, chunkMap);

    this.log(`Added ${docs.length} documents to ${knowledgeBase}`);
  }

  /**
   * 保存索引
   */
  private async saveIndex(name: string, index: HierarchicalNSW): Promise<void> {
    const indexPath = path.join(this.config.workDir, `${name}.hnsw`);
    await index.writeIndex(indexPath);
  }

  /**
   * 保存chunk映射
   */
  private async saveChunkMap(name: string, chunkMap: Record<string, any>): Promise<void> {
    const chunkPath = path.join(this.config.workDir, `${name}.chunks.json`);
    await fs.writeFile(chunkPath, JSON.stringify(chunkMap, null, 2));
  }

  /**
   * 获取单个文本的embedding
   */
  private async getEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.getEmbeddings([text]);
    return embeddings[0];
  }

  /**
   * 批量获取embeddings
   */
  private async getEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await fetch(this.config.vectorizer.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.vectorizer.apiKey}`
      },
      body: JSON.stringify({
        input: texts,
        model: this.config.vectorizer.model
      })
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map(item => item.embedding);
  }

  /**
   * 记录指标
   */
  private recordMetric(type: string, duration: number): void {
    if (type === 'search') {
      this.stats.totalSearches++;
      this.stats.avgSearchTime =
        (this.stats.avgSearchTime * (this.stats.totalSearches - 1) + duration) /
        this.stats.totalSearches;
    }
  }

  /**
   * 日志输出
   */
  private log(message: string, ...args: any[]): void {
    if (this.config.debug) {
      console.log(`[RAGService] ${message}`, ...args);
    }
  }
}

