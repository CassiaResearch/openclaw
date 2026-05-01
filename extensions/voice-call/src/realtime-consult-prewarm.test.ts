import { describe, expect, it, vi } from "vitest";
import { prewarmVoiceCallConsultAgent } from "./realtime-consult-prewarm.js";

function createAgentRuntime() {
  const ensureAgentWorkspace = vi.fn(async () => {});
  const loadSessionStore = vi.fn(() => ({}));
  const runEmbeddedPiAgent = vi.fn();
  return {
    runtime: {
      resolveAgentDir: vi.fn(() => "/tmp/agent"),
      resolveAgentWorkspaceDir: vi.fn(() => "/tmp/workspace"),
      ensureAgentWorkspace,
      resolveAgentTimeoutMs: vi.fn(() => 30_000),
      resolveThinkingDefault: vi.fn(() => "high"),
      session: {
        resolveStorePath: vi.fn(() => "/tmp/sessions.json"),
        loadSessionStore,
        saveSessionStore: vi.fn(async () => {}),
        resolveSessionFilePath: vi.fn(() => "/tmp/session.json"),
      },
      runEmbeddedPiAgent,
    },
    ensureAgentWorkspace,
    loadSessionStore,
    runEmbeddedPiAgent,
  };
}

describe("prewarmVoiceCallConsultAgent", () => {
  it("ensures workspace and primes session store for the resolved agent", async () => {
    const { runtime, ensureAgentWorkspace, loadSessionStore, runEmbeddedPiAgent } =
      createAgentRuntime();

    await prewarmVoiceCallConsultAgent({
      cfg: {} as never,
      agentRuntime: runtime as never,
      agentId: "voice",
    });

    expect(runtime.resolveAgentWorkspaceDir).toHaveBeenCalledWith({}, "voice");
    expect(ensureAgentWorkspace).toHaveBeenCalledWith({ dir: "/tmp/workspace" });
    expect(runtime.session.resolveStorePath).toHaveBeenCalledWith(undefined, { agentId: "voice" });
    expect(loadSessionStore).toHaveBeenCalledWith("/tmp/sessions.json");
    expect(runEmbeddedPiAgent).not.toHaveBeenCalled();
  });

  it("defaults to the main agent id when none is provided", async () => {
    const { runtime } = createAgentRuntime();

    await prewarmVoiceCallConsultAgent({
      cfg: {} as never,
      agentRuntime: runtime as never,
    });

    expect(runtime.resolveAgentWorkspaceDir).toHaveBeenCalledWith({}, "main");
    expect(runtime.session.resolveStorePath).toHaveBeenCalledWith(undefined, { agentId: "main" });
  });
});
