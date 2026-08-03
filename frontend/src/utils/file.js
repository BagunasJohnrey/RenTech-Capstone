// Read a File/Blob to a base64 string (no data: prefix) for the server-side
// Supabase upload endpoint, which expects raw base64 bytes in `data`.
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
