# Development Environment Test

## How to Test Concurrent Development Setup

1. Run the concurrent development environment:
   ```bash
   npm run dev
   ```

2. Verify both servers are running:
   - Backend should be accessible at http://localhost:3001
   - Frontend should be accessible at http://localhost:5174 (or next available port)

3. Test automatic restarts:
   - Make a small change to any file in `backend/src/` (e.g., add a comment)
   - Observe that the backend automatically restarts in the terminal output
   - The frontend should automatically reload when changes are made to `frontend/src/`

4. Expected behavior:
   - `[BACKEND] [nodemon] restarting due to changes...` should appear when backend files change
   - Frontend should show `[vite] hot updated: /src/...` when frontend files change
   - Both processes should continue running without manual intervention

This setup allows you to develop both the frontend and backend simultaneously with automatic reloading on file changes.