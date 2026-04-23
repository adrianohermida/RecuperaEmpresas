'use strict';

const fs = require('fs').promises;
const path = require('path');
const { sb } = require('./config');

/**
 * BP-BE-02: Persistência de Arquivos
 * Faz upload de um arquivo local para o Supabase Storage (Bucket: business-plan).
 * 
 * @param {string} localPath - Caminho do arquivo temporário no disco
 * @param {string} remotePath - Caminho destino no bucket (ex: "userId/chapterId/fileId_name.ext")
 * @param {string} contentType - Tipo MIME do arquivo
 * @returns {Promise<string>} - URL pública do arquivo ou caminho interno
 */
async function uploadToStorage(localPath, remotePath, contentType) {
  try {
    const fileBuffer = await fs.readFile(localPath);
    
    const { data, error } = await sb.storage
      .from('business-plan')
      .upload(remotePath, fileBuffer, {
        contentType,
        upsert: true
      });

    if (error) {
      console.error('[storage] Upload error:', error);
      throw new Error('Erro no upload para Supabase Storage: ' + error.message);
    }

    // Retorna o caminho para persistência nos metadados do capítulo
    return data.path;
  } catch (err) {
    console.error('[storage] uploadToStorage error:', err);
    throw err;
  }
}

/**
 * Remove um arquivo do Supabase Storage.
 */
async function removeFromStorage(remotePath) {
  try {
    const { error } = await sb.storage
      .from('business-plan')
      .remove([remotePath]);

    if (error) {
      console.error('[storage] Remove error:', error);
    }
  } catch (err) {
    console.error('[storage] removeFromStorage error:', err);
  }
}

/**
 * Gera uma URL assinada ou pública para o arquivo.
 */
function getPublicUrl(remotePath) {
  const { data } = sb.storage
    .from('business-plan')
    .getPublicUrl(remotePath);
  
  return data.publicUrl;
}

module.exports = {
  uploadToStorage,
  removeFromStorage,
  getPublicUrl
};
