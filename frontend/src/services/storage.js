import { api } from '../utils/api';

// Supabase Storage flows. Photos are uploaded server-side: the browser sends
// the file bytes (base64) to our API, which writes them to the private bucket
// using the service-role client.
export const storageService = {
  upload: (fileName, contentType, data) =>
    api.post('/storage/upload', { fileName, contentType, data }),

  getDownloadUrl: (path) => api.get(`/storage/${path}`),
};
