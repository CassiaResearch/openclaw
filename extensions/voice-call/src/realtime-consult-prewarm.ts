import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import type { CoreAgentDeps } from "./core-bridge.js";

export async function prewarmVoiceCallConsultAgent(params: {
  cfg: OpenClawConfig;
  agentRuntime: CoreAgentDeps;
  agentId?: string;
}): Promise<void> {
  const agentId = params.agentId ?? "main";
  const workspaceDir = params.agentRuntime.resolveAgentWorkspaceDir(params.cfg, agentId);
  await params.agentRuntime.ensureAgentWorkspace({ dir: workspaceDir });
  const storePath = params.agentRuntime.session.resolveStorePath(params.cfg.session?.store, {
    agentId,
  });
  params.agentRuntime.session.loadSessionStore(storePath);
}
