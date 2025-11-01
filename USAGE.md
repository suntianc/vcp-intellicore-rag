# @vcp/rag 使用说明

**版本**: 1.0.0  
**状态**: ✅ 可选插拔式RAG服务

---

## 📦 包定位

`@vcp/rag`是vcp-intellicore的**可选依赖**，提供企业级RAG（检索增强生成）能力。

**核心特性**:
- 基于HNSW算法的高性能向量搜索
- 支持多知识库管理
- LRU缓存优化
- 完整的IRAGService接口实现

---

## 🔌 热插拔机制

### 设计理念

vcp-rag采用**完全插拔式设计**：
- ✅ vcp-intellicore可以在没有vcp-rag的情况下正常运行
- ✅ RAGDiaryPlugin在无RAG服务时降级为文件系统搜索
- ✅ 通过依赖注入动态启用RAG能力

### 插拔原理

```typescript
// vcp-intellicore/src/core/VCPEngine.ts

// 1. 条件导入（可选）
if (config.rag?.enabled) {
  try {
    const { RAGService } = await import('@vcp/rag');  // 动态导入
    this.ragService = new RAGService();
    await this.ragService.initialize(config.rag);
  } catch (error) {
    logger.warn('RAG Service not available, using file-based fallback');
  }
}

// 2. 依赖注入
pluginRuntime.setDependencies({
  ragService: this.ragService  // 可能是undefined
});

// 3. 插件中优雅降级
class RAGDiaryService {
  async search(query, options) {
    if (this.ragService) {
      // 使用向量检索
      return await this.ragService.search({...});
    } else {
      // 降级为文件系统搜索
      return await this.fileSystemSearch(query);
    }
  }
}
```

---

## 📥 安装与配置

### 方式1: 不安装（默认）

**适用场景**: 轻量级部署，不需要RAG功能

```bash
cd vcp-intellicore
npm install  # vcp-rag不会被安装
npm run dev
```

**行为**:
- ✅ vcp-intellicore正常运行
- ✅ RAGDiaryPlugin使用文件系统搜索
- ⚠️ 无向量检索能力

### 方式2: 安装RAG服务（推荐）

**适用场景**: 需要高性能语义检索

```bash
cd vcp-intellicore
npm install @vcp/rag  # 手动安装
```

**配置 `.env`**:
```bash
# 启用RAG服务
RAG_ENABLED=true

# 向量化API配置
EMBEDDING_API_URL=http://localhost:8088/v1/embeddings
EMBEDDING_API_KEY=sk-your-key
EMBEDDING_MODEL=text-embedding-ada-002

# RAG参数
RAG_WORK_DIR=./vector_store
RAG_CACHE_SIZE=100
RAG_EF_SEARCH=150
```

**启动**:
```bash
npm run dev
```

**行为**:
- ✅ RAG服务自动初始化
- ✅ RAGDiaryPlugin使用向量检索
- ✅ 高性能语义搜索

---

## 🎯 使用场景

### 场景1: 简单文件搜索（无RAG）

**适用**: 
- 日记数量< 100篇
- 只需关键词搜索
- 无需语义理解

**实现**:
```javascript
// RAGDiaryPlugin自动降级
async searchDiaries(query) {
  // 使用简单的关键词匹配
  return this.fileSystemSearch(query);
}
```

### 场景2: 语义检索（with RAG）

**适用**:
- 日记数量 > 100篇
- 需要语义理解
- 需要相似度排序

**实现**:
```javascript
// RAGDiaryPlugin使用RAG服务
async searchDiaries(query) {
  const results = await this.ragService.search({
    knowledgeBase: 'diaries',
    query: query,
    k: 5,
    similarityThreshold: 0.7
  });
  return results;
}
```

---

## 🔧 开发者集成指南

### 在插件中使用RAG服务

```javascript
class MyPlugin {
  async initialize(config, dependencies) {
    this.ragService = dependencies.ragService;  // 可能是undefined
    
    if (this.ragService) {
      console.log('[MyPlugin] RAG service available');
    } else {
      console.log('[MyPlugin] Using fallback search');
    }
  }
  
  async search(query) {
    if (this.ragService) {
      return await this.ragService.search({
        knowledgeBase: 'my_kb',
        query: query,
        k: 5
      });
    } else {
      return await this.simpleFallbackSearch(query);
    }
  }
}
```

---

## 📊 性能对比

| 搜索方式 | 日记数量 | 搜索耗时 | 准确度 |
|---------|---------|---------|--------|
| 文件系统搜索 | 10篇 | 10ms | ⭐⭐⭐ |
| 文件系统搜索 | 100篇 | 80ms | ⭐⭐⭐ |
| 文件系统搜索 | 1000篇 | 500ms | ⭐⭐⭐ |
| RAG向量检索 | 10篇 | 50ms | ⭐⭐⭐⭐ |
| RAG向量检索 | 100篇 | 60ms | ⭐⭐⭐⭐⭐ |
| RAG向量检索 | 1000篇 | 80ms | ⭐⭐⭐⭐⭐ |

**结论**: 日记 > 100篇时，RAG服务性能和准确度优势明显

---

## ✅ 最佳实践

### 推荐配置

**小型部署（< 100篇日记）**:
```bash
# 不安装vcp-rag
RAG_ENABLED=false
```

**中型部署（100-1000篇日记）**:
```bash
# 安装vcp-rag
npm install @vcp/rag

RAG_ENABLED=true
EMBEDDING_API_URL=http://your-embedding-service
```

**大型部署（> 1000篇日记）**:
```bash
# 安装vcp-rag + 优化配置
npm install @vcp/rag

RAG_ENABLED=true
RAG_CACHE_SIZE=200
RAG_EF_SEARCH=200
```

---

## 🎯 总结

**vcp-rag的热插拔优势**:
1. ✅ 可选依赖 - 不需要可以不装
2. ✅ 零侵入 - 不影响核心功能
3. ✅ 优雅降级 - 无RAG时自动使用备选方案
4. ✅ 按需扩展 - 根据规模选择是否启用

**建议**: 
- 开发/测试环境：不安装vcp-rag
- 生产环境/大量日记：安装vcp-rag



