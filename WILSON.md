# Wilson CLI - Project Context

## CRITICAL ANTI-LOOP RULES

These rules MUST be followed to prevent runaway behavior:

### 1. NEVER Create New Project Directories as Error Workarounds
- When encountering build errors, dependency issues, or compilation failures: **FIX IN PLACE**
- Do NOT create directories like `project-v2`, `project-fixed`, `project-simple`, `project-ultimate`, etc.
- Creating a new directory is NOT a solution to a build error
- If the current directory has issues, debug and resolve them there

### 2. Directory Creation Limits
- Maximum 1 new directory per conversation without explicit user approval
- Before creating ANY directory outside the current working directory, ASK the user first
- Never create directories on Desktop without user confirmation

### 3. Error Handling Protocol
When you encounter an error:
1. READ the actual error message carefully
2. IDENTIFY the specific issue (missing dependency, syntax error, config problem)
3. FIX the specific issue in the existing files
4. RETRY the build/command
5. If still failing after 3 attempts, ASK the user for guidance
6. NEVER "start fresh" by creating a new directory

### 4. Loop Detection
- If you find yourself doing the same action more than 3 times, STOP and ask the user
- If you've created more than 1 directory in a conversation, STOP and ask the user
- If a build keeps failing with the same error, STOP and ask the user

## Project Info

Wilson is a CLI tool for store management with AI assistance.
- Built with TypeScript/Bun
- Uses Supabase for backend
- Supports MCP (Model Context Protocol) servers
