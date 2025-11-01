# VCP IntelliCore RAG

RAG (Retrieval-Augmented Generation) service for VCP IntelliCore with vector search and semantic capabilities.

## Features

- **Vector Search** - High-performance HNSW algorithm-based vector search
- **Semantic Search** - Natural language query support
- **Knowledge Base Management** - Multiple independent knowledge bases
- **Cache Optimization** - LRU cache with TTL for improved performance
- **Pluggable Design** - Implements SDK's `IRAGService` interface

## Installation

```bash
npm install vcp-intellicore-rag vcp-intellicore-sdk
```

## Quick Start

```typescript
import { RAGService } from 'vcp-intellicore-rag';

// Create RAG service instance
const ragService = new RAGService();

// Initialize service
await ragService.initialize({
  workDir: './vector_store',
  vectorizer: {
    apiUrl: 'https://api.openai.com/v1/embeddings',
    apiKey: 'your-api-key',
    model: 'text-embedding-3-small'
  },
  cacheSize: 100,
  debug: false
});

// Add document
await ragService.addDocument({
  content: 'VCP IntelliCore is a powerful AI server.',
  knowledgeBase: 'docs',
  metadata: {
    source: 'introduction.md',
    tags: ['documentation']
  }
});

// Search
const results = await ragService.search({
  query: 'What is VCP IntelliCore?',
  knowledgeBase: 'docs',
  k: 5
});

console.log(results); // Top 5 most relevant documents
```

## API Reference

### Initialize

```typescript
await ragService.initialize({
  workDir: './vector_store',      // Storage directory
  vectorizer: {
    apiUrl: string,                // Embedding API URL
    apiKey: string,                // API key
    model: string,                 // Model name
    dimensions?: number,           // Vector dimensions (default: 1536)
    batchSize?: number             // Batch size (default: 100)
  },
  cacheSize?: number,              // Cache size (default: 100)
  cacheTTL?: number,               // Cache TTL in ms (default: 3600000)
  debug?: boolean                  // Debug mode (default: false)
});
```

### Add Document

```typescript
await ragService.addDocument({
  content: string,                 // Document content
  knowledgeBase: string,           // Knowledge base name
  metadata?: {                     // Optional metadata
    source?: string,
    tags?: string[],
    timestamp?: number,
    [key: string]: any
  }
});
```

### Add Batch Documents

```typescript
await ragService.addDocuments([
  {
    content: 'Document 1',
    knowledgeBase: 'kb1',
    metadata: { source: 'file1.txt' }
  },
  {
    content: 'Document 2',
    knowledgeBase: 'kb1',
    metadata: { source: 'file2.txt' }
  }
]);
```

### Search

```typescript
const results = await ragService.search({
  query: string,                   // Search query
  knowledgeBase: string,           // Knowledge base name
  k?: number,                      // Number of results (default: 5)
  threshold?: number               // Similarity threshold (default: 0.0)
});

// Results format
[
  {
    content: string,               // Document content
    score: number,                 // Similarity score (0-1)
    metadata: object               // Document metadata
  }
]
```

### Get Knowledge Base Info

```typescript
const info = await ragService.getKnowledgeBaseInfo('kb_name');

// Returns
{
  name: string,
  documentCount: number,
  dimensions: number,
  createdAt: number,
  updatedAt: number
}
```

### List Knowledge Bases

```typescript
const knowledgeBases = await ragService.listKnowledgeBases();

// Returns array of knowledge base names
['kb1', 'kb2', 'kb3']
```

### Delete Knowledge Base

```typescript
await ragService.deleteKnowledgeBase('kb_name');
```

## Integration with VCP IntelliCore

```typescript
import { VCPEngine } from 'vcp-intellicore-sdk';
import { RAGService } from 'vcp-intellicore-rag';

// Create and initialize RAG service
const ragService = new RAGService();
await ragService.initialize({ /* config */ });

// Inject into VCP Engine
const vcpEngine = new VCPEngine({
  workDir: './data',
  pluginDirectory: './plugins',
  ragService: ragService  // Inject RAG service
});

await vcpEngine.initialize();

// Now you can use {{rag:*}} variables
const result = await vcpEngine.variableEngine.resolve(
  'Search results: {{rag:docs:project:basic}}',
  { 
    role: 'user',
    ragParams: { query: 'VCP features' }
  }
);
```

## Configuration Examples

### OpenAI

```typescript
await ragService.initialize({
  workDir: './vector_store',
  vectorizer: {
    apiUrl: 'https://api.openai.com/v1/embeddings',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'text-embedding-3-small',
    dimensions: 1536
  }
});
```

### Custom Embedding Service

```typescript
await ragService.initialize({
  workDir: './vector_store',
  vectorizer: {
    apiUrl: 'http://localhost:8000/embeddings',
    apiKey: 'your-key',
    model: 'custom-model',
    dimensions: 768
  }
});
```

## Performance

- **HNSW Algorithm** - Fast approximate nearest neighbor search
- **LRU Cache** - Reduces redundant API calls
- **Batch Processing** - Efficient batch embedding generation
- **Persistent Storage** - Data persists across restarts

## TypeScript Support

Full TypeScript support with type definitions included.

```typescript
import type {
  RAGDocument,
  RAGSearchOptions,
  RAGSearchResult,
  KnowledgeBaseInfo
} from 'vcp-intellicore-rag';
```

## License

Apache-2.0

## Links

- GitHub: https://github.com/suntianc/vcp-intellicore-rag
- npm: https://www.npmjs.com/package/vcp-intellicore-rag
- Issues: https://github.com/suntianc/vcp-intellicore-rag/issues
