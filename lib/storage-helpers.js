'use strict';

/**
 * BP-BE-02: Storage Helpers para Supabase Storage
 * Gerencia upload, download e remoção de arquivos do Business Plan
 */

const { sb } = require('./config');
const path = require('path');

const STORAGE_BUCKET = 'business-plan-attachments';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Inicializa o bucket de storage (cria se não existir)
 */
async function initializeStorageBucket() {
  try {
    const { data: buckets } = await sb.storage.listBuckets();
    const exists = buckets?.some(b => b.name === STORAGE_BUCKET);
    
    if (!exists) {
      await sb.storage.createBucket(STORAGE_BUCKET, {
        public: false,
        allowedMimeTypes: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'image/jpeg',
          'image/png',
          'image/gif',
          'application/zip',
          'application/x-rar-compressed',
        ],
      });
      console.log('[storage-helpers] Bucket criado:', STORAGE_BUCKET);
    }
  } catch (err) {
    console.warn('[storage-helpers] Erro ao inicializar bucket:', err.message);
  }
}

/**
 * Gera um caminho único para armazenar o arquivo no Storage
 * @param {string} userId - ID do cliente
 * @param {number} chapterId - ID do capítulo
 * @param {string} fileName - Nome original do arquivo
 */
function generateStoragePath(userId, chapterId, fileName) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  const cleanName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
  
  return `${userId}/${chapterId}/${timestamp}_${random}_${cleanName}${ext}`;
}

/**
 * Faz upload de um arquivo para o Supabase Storage
 * @param {Buffer} fileBuffer - Conteúdo do arquivo
 * @param {string} userId - ID do cliente
 * @param {number} chapterId - ID do capítulo
 * @param {string} fileName - Nome original do arquivo
 * @param {string} mimeType - Tipo MIME do arquivo
 * @returns {Promise<object>} Metadados do arquivo armazenado
 */
async function uploadFile(fileBuffer, userId, chapterId, fileName, mimeType) {
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error('Arquivo vazio.');
  }
  
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(`Arquivo excede o tamanho máximo de ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
  }
  
  const storagePath = generateStoragePath(userId, chapterId, fileName);
  
  const { error } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });
  
  if (error) {
    throw new Error(`Erro ao fazer upload: ${error.message}`);
  }
  
  return {
    id: storagePath,
    name: fileName,
    size: fileBuffer.length,
    type: mimeType,
    storagePath: storagePath,
    uploadedAt: new Date().toISOString(),
  };
}

/**
 * Gera uma URL assinada (com expiração) para download seguro
 * @param {string} storagePath - Caminho do arquivo no Storage
 * @param {number} expirationSeconds - Tempo de expiração em segundos (padrão: 1 hora)
 * @returns {Promise<string>} URL assinada para download
 */
async function generateSignedDownloadUrl(storagePath, expirationSeconds = 3600) {
  const { data, error } = await sb.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, expirationSeconds);
  
  if (error) {
    throw new Error(`Erro ao gerar URL assinada: ${error.message}`);
  }
  
  return data.signedUrl;
}

/**
 * Valida acesso a um arquivo antes de permitir download
 * @param {string} userId - ID do cliente
 * @param {number} chapterId - ID do capítulo
 * @param {string} storagePath - Caminho do arquivo
 * @returns {Promise<boolean>} True se o acesso é válido
 */
async function validateFileAccess(userId, chapterId, storagePath) {
  // Validar que o storagePath pertence ao userId/chapterId correto
  const expectedPrefix = `${userId}/${chapterId}/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    return false;
  }
  
  // Validar que o arquivo existe
  const { data, error } = await sb.storage
    .from(STORAGE_BUCKET)
    .list(`${userId}/${chapterId}`, {
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' },
    });
  
  if (error) return false;
  
  const fileName = storagePath.split('/').pop();
  return data?.some(f => f.name === fileName) || false;
}

/**
 * Remove um arquivo do Storage
 * @param {string} storagePath - Caminho do arquivo
 */
async function deleteFile(storagePath) {
  const { error } = await sb.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath]);
  
  if (error) {
    throw new Error(`Erro ao remover arquivo: ${error.message}`);
  }
}

/**
 * Lista todos os arquivos de um capítulo
 * @param {string} userId - ID do cliente
 * @param {number} chapterId - ID do capítulo
 * @returns {Promise<object[]>} Lista de arquivos
 */
async function listChapterFiles(userId, chapterId) {
  const { data, error } = await sb.storage
    .from(STORAGE_BUCKET)
    .list(`${userId}/${chapterId}`, {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'desc' },
    });
  
  if (error) {
    console.error('[storage-helpers] Erro ao listar arquivos:', error);
    return [];
  }
  
  return data || [];
}

module.exports = {
  initializeStorageBucket,
  uploadFile,
  generateSignedDownloadUrl,
  validateFileAccess,
  deleteFile,
  listChapterFiles,
  STORAGE_BUCKET,
};
