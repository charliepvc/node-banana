# AGENTS.md - Node Banana

## Quick Start & Commands
- **Dev**: `npm run dev` (http://localhost:3000)
- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Test**: `npm run test` (watch), `npm run test:run` (CI)
- **Env**: `.env.local` required (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `KIE_API_KEY`)

## Architecture Key Points
- **Framework**: Next.js 16 (App Router), TypeScript.
- **Canvas**: `@xyflow/react` (React Flow) + `react-konva` (annotations).
- **State**: Centralized Zustand store in `src/store/workflowStore.ts`.
- **Execution**: Topological sort of nodes via `executeWorkflow()`.
- **Data Flow**: `getConnectedInputs(nodeId)` is the primary way to retrieve upstream data.

## Critical Files
- `src/store/workflowStore.ts`: State, execution logic, and default node data.
- `src/types/index.ts`: All TypeScript interfaces and `NodeType` union.
- `src/components/WorkflowCanvas.tsx`: Canvas config and connection validation (`isValidConnection`).
- `src/app/api/generate/route.ts`: Main image generation logic.

## Development Workflows
- **Adding Nodes**: Follow the 11-step checklist in `CLAUDE.md`. Must update `types`, `workflowStore`, `BaseNode` (if needed), `WorkflowCanvas`, and `ConnectionDropMenu`.
- **Adding Kie.ai Models**: Follow the 6-step SOP in `CLAUDE.md`. Involves registry (`/api/models/route.ts`), schema, defaults, and mapping.
- **Node Connections**: Must match types (`image` $\to$ `image`, `text` $\to$ `text`, `audio` $\to$ `audio`).

## Git & Workflow
- **Base Branch**: `develop` (NEVER push to `main`).
- **Branches**: `feature/<desc>` or `fix/<desc>` from `develop`.
- **PRs**: Target `develop`.
- **Commits**: Atomic commits per task. Do NOT commit files in `.planning/`.

## Common Gotchas
- **Handle IDs**: Use `id="image"`, `id="text"`, etc., to ensure type matching works.
- **Topological Sort**: Ensure nodes that depend on others are correctly connected; otherwise, they won't execute in order.
- **Zustand Store**: Avoid duplicating state; use `useWorkflowStore()`.
