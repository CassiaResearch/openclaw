import { Type } from "@sinclair/typebox";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import {
  definePluginEntry,
  type GatewayRequestHandlerOptions,
  type OpenClawPluginApi,
} from "./api.js";
import { createVoiceCallRuntime, type VoiceCallRuntime } from "./runtime-entry.js";
import { registerVoiceCallCli } from "./src/cli.js";
import {
  formatVoiceCallLegacyConfigWarnings,
  normalizeVoiceCallLegacyConfigInput,
  parseVoiceCallPluginConfig,
} from "./src/config-compat.js";
import {
  resolveVoiceCallConfig,
  validateProviderConfig,
  type VoiceCallConfig,
} from "./src/config.js";
import type { CoreConfig } from "./src/core-bridge.js";
import { TerminalStates } from "./src/types.js";

const voiceCallConfigSchema = {
  parse(value: unknown): VoiceCallConfig {
    const normalized = normalizeVoiceCallLegacyConfigInput(value);
    const enabled = typeof normalized.enabled === "boolean" ? normalized.enabled : true;
    return parseVoiceCallPluginConfig({
      ...normalized,
      enabled,
      provider: normalized.provider ?? (enabled ? "mock" : undefined),
    });
  },
  uiHints: {
    provider: {
      label: "Provider",
      help: "Use twilio, telnyx, or mock for dev/no-network.",
    },
    fromNumber: { label: "From Number", placeholder: "+15550001234" },
    toNumber: { label: "Default To Number", placeholder: "+15550001234" },
    inboundPolicy: { label: "Inbound Policy" },
    allowFrom: { label: "Inbound Allowlist" },
    inboundGreeting: { label: "Inbound Greeting", advanced: true },
    "telnyx.apiKey": { label: "Telnyx API Key", sensitive: true },
    "telnyx.connectionId": { label: "Telnyx Connection ID" },
    "telnyx.publicKey": { label: "Telnyx Public Key", sensitive: true },
    "twilio.accountSid": { label: "Twilio Account SID" },
    "twilio.authToken": { label: "Twilio Auth Token", sensitive: true },
    "outbound.defaultMode": { label: "Default Call Mode" },
    "outbound.notifyHangupDelaySec": {
      label: "Notify Hangup Delay (sec)",
      advanced: true,
    },
    "serve.port": { label: "Webhook Port" },
    "serve.bind": { label: "Webhook Bind" },
    "serve.path": { label: "Webhook Path" },
    "tailscale.mode": { label: "Tailscale Mode", advanced: true },
    "tailscale.path": { label: "Tailscale Path", advanced: true },
    "tunnel.provider": { label: "Tunnel Provider", advanced: true },
    "tunnel.ngrokAuthToken": {
      label: "ngrok Auth Token",
      sensitive: true,
      advanced: true,
    },
    "tunnel.ngrokDomain": { label: "ngrok Domain", advanced: true },
    "tunnel.allowNgrokFreeTierLoopbackBypass": {
      label: "Allow ngrok Free Tier (Loopback Bypass)",
      advanced: true,
    },
    "streaming.enabled": { label: "Enable Streaming", advanced: true },
    "streaming.provider": {
      label: "Streaming Provider",
      help: "Uses the first registered realtime transcription provider when unset.",
      advanced: true,
    },
    "streaming.providers": { label: "Streaming Provider Config", advanced: true },
    "streaming.streamPath": { label: "Media Stream Path", advanced: true },
    "realtime.enabled": { label: "Enable Realtime Voice", advanced: true },
    "realtime.provider": {
      label: "Realtime Voice Provider",
      help: "Uses the first registered realtime voice provider when unset.",
      advanced: true,
    },
    "realtime.streamPath": { label: "Realtime Stream Path", advanced: true },
    "realtime.instructions": { label: "Realtime Instructions", advanced: true },
    "realtime.providers": { label: "Realtime Provider Config", advanced: true },
    "tts.provider": {
      label: "TTS Provider Override",
      help: "Deep-merges with messages.tts (Microsoft is ignored for calls).",
      advanced: true,
    },
    "tts.providers": { label: "TTS Provider Config", advanced: true },
    publicUrl: { label: "Public Webhook URL", advanced: true },
    skipSignatureVerification: {
      label: "Skip Signature Verification",
      advanced: true,
    },
    store: { label: "Call Log Store Path", advanced: true },
    responseModel: {
      label: "Response Model",
      help: "Optional override. Falls back to the runtime default model when unset.",
      advanced: true,
    },
    responseSystemPrompt: { label: "Response System Prompt", advanced: true },
    responseTimeoutMs: { label: "Response Timeout (ms)", advanced: true },
  },
};

const VoiceCallToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("initiate_call"),
    to: Type.Optional(Type.String({ description: "Call target" })),
    message: Type.Optional(Type.String({ description: "Intro message" })),
    mode: Type.Optional(
      Type.Union([
        Type.Literal("notify"),
        Type.Literal("conversation"),
        Type.Literal("realtime-conversation"),
      ]),
    ),
    realtimeConfig: Type.Optional(
      Type.Object({
        instructions: Type.String({
          description: "Instructions for the realtime voice provider",
        }),
      }),
    ),
  }),
  Type.Object({
    action: Type.Literal("continue_call"),
    callId: Type.String({ description: "Call ID" }),
    message: Type.String({ description: "Follow-up message" }),
  }),
  Type.Object({
    action: Type.Literal("speak_to_user"),
    callId: Type.String({ description: "Call ID" }),
    message: Type.String({ description: "Message to speak" }),
  }),
  Type.Object({
    action: Type.Literal("end_call"),
    callId: Type.String({ description: "Call ID" }),
  }),
  Type.Object({
    action: Type.Literal("get_status"),
    callId: Type.String({ description: "Call ID" }),
  }),
  Type.Object({
    action: Type.Literal("monitor_call"),
    callId: Type.String({ description: "Call ID to monitor until completion" }),
  }),
  Type.Object({
    mode: Type.Optional(Type.Union([Type.Literal("call"), Type.Literal("status")])),
    to: Type.Optional(Type.String({ description: "Call target" })),
    sid: Type.Optional(Type.String({ description: "Call SID" })),
    message: Type.Optional(Type.String({ description: "Optional intro message" })),
  }),
]);

export default definePluginEntry({
  id: "voice-call",
  name: "Voice Call",
  description: "Voice-call plugin with Telnyx/Twilio/Plivo providers",
  configSchema: voiceCallConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = resolveVoiceCallConfig(voiceCallConfigSchema.parse(api.pluginConfig));
    const validation = validateProviderConfig(config);

    if (api.pluginConfig && typeof api.pluginConfig === "object") {
      for (const warning of formatVoiceCallLegacyConfigWarnings({
        value: api.pluginConfig,
        configPathPrefix: "plugins.entries.voice-call.config",
        doctorFixCommand: "openclaw doctor --fix",
      })) {
        api.logger.warn(warning);
      }
    }

    const VOICE_RUNTIME_KEY = Symbol.for("openclaw.voice.runtime");
    const VOICE_RUNTIME_PROMISE_KEY = Symbol.for("openclaw.voice.runtimePromise");
    const VOICE_RUNTIME_STOP_PROMISE_KEY = Symbol.for("openclaw.voice.runtimeStopPromise");

    const globalState = globalThis as typeof globalThis & {
      [VOICE_RUNTIME_KEY]?: VoiceCallRuntime | null;
      [VOICE_RUNTIME_PROMISE_KEY]?: Promise<VoiceCallRuntime> | null;
      [VOICE_RUNTIME_STOP_PROMISE_KEY]?: Promise<void> | null;
    };

    globalState[VOICE_RUNTIME_KEY] ??= null;
    globalState[VOICE_RUNTIME_PROMISE_KEY] ??= null;
    globalState[VOICE_RUNTIME_STOP_PROMISE_KEY] ??= null;
    const RETRY_ENSURE_RUNTIME = Symbol("voice-call.ensureRuntime.retry");

    const ensureRuntime = async (): Promise<VoiceCallRuntime> => {
      if (!config.enabled) {
        throw new Error("Voice call disabled in plugin config");
      }
      if (!validation.valid) {
        throw new Error(validation.errors.join("; "));
      }

      while (true) {
        if (globalState[VOICE_RUNTIME_STOP_PROMISE_KEY]) {
          await globalState[VOICE_RUNTIME_STOP_PROMISE_KEY];
          continue;
        }

        if (globalState[VOICE_RUNTIME_KEY]) {
          return globalState[VOICE_RUNTIME_KEY];
        }

        let runtimePromise = globalState[VOICE_RUNTIME_PROMISE_KEY];
        if (!runtimePromise) {
          runtimePromise = createVoiceCallRuntime({
            config,
            coreConfig: api.config as CoreConfig,
            fullConfig: api.config,
            agentRuntime: api.runtime.agent,
            ttsRuntime: api.runtime.tts,
            logger: api.logger,
          });
          globalState[VOICE_RUNTIME_PROMISE_KEY] = runtimePromise;
        }

        try {
          const runtime = await runtimePromise;
          const stopPromise: Promise<void> | null =
            globalState[VOICE_RUNTIME_STOP_PROMISE_KEY] ?? null;
          if (stopPromise !== null) {
            await Promise.resolve(stopPromise);
            if (globalState[VOICE_RUNTIME_KEY]) {
              return globalState[VOICE_RUNTIME_KEY];
            }
            throw RETRY_ENSURE_RUNTIME;
          }
          if (globalState[VOICE_RUNTIME_PROMISE_KEY] !== runtimePromise) {
            if (globalState[VOICE_RUNTIME_KEY]) {
              return globalState[VOICE_RUNTIME_KEY];
            }
            throw RETRY_ENSURE_RUNTIME;
          }
          globalState[VOICE_RUNTIME_KEY] = runtime;
          return runtime;
        } catch (err) {
          if (err === RETRY_ENSURE_RUNTIME) {
            continue;
          }
          if (globalState[VOICE_RUNTIME_PROMISE_KEY] === runtimePromise) {
            globalState[VOICE_RUNTIME_PROMISE_KEY] = null;
            globalState[VOICE_RUNTIME_KEY] = null;
          }
          throw err;
        }
      }
    };

    const sendError = (respond: (ok: boolean, payload?: unknown) => void, err: unknown) => {
      respond(false, { error: formatErrorMessage(err) });
    };

    const resolveCallMessageRequest = async (params: GatewayRequestHandlerOptions["params"]) => {
      const callId = normalizeOptionalString(params?.callId) ?? "";
      const message = normalizeOptionalString(params?.message) ?? "";
      if (!callId || !message) {
        return { error: "callId and message required" } as const;
      }
      const rt = await ensureRuntime();
      return { rt, callId, message } as const;
    };
    const initiateCallAndRespond = async (params: {
      rt: VoiceCallRuntime;
      respond: GatewayRequestHandlerOptions["respond"];
      to: string;
      message?: string;
      mode?: "notify" | "conversation" | "realtime-conversation";
      realtimeConfig?: Record<string, unknown>;
    }) => {
      const result = await params.rt.manager.initiateCall(params.to, undefined, {
        message: params.message,
        mode: params.mode,
        realtimeConfig: params.realtimeConfig,
      });
      if (!result.success) {
        params.respond(false, { error: result.error || "initiate failed" });
        return;
      }
      params.respond(true, { callId: result.callId, initiated: true });
    };

    const respondToCallMessageAction = async (params: {
      requestParams: GatewayRequestHandlerOptions["params"];
      respond: GatewayRequestHandlerOptions["respond"];
      action: (
        request: Exclude<Awaited<ReturnType<typeof resolveCallMessageRequest>>, { error: string }>,
      ) => Promise<{
        success: boolean;
        error?: string;
        transcript?: string;
      }>;
      failure: string;
      includeTranscript?: boolean;
    }) => {
      const request = await resolveCallMessageRequest(params.requestParams);
      if ("error" in request) {
        params.respond(false, { error: request.error });
        return;
      }
      const result = await params.action(request);
      if (!result.success) {
        params.respond(false, { error: result.error || params.failure });
        return;
      }
      params.respond(
        true,
        params.includeTranscript
          ? { success: true, transcript: result.transcript }
          : { success: true },
      );
    };

    api.registerGatewayMethod(
      "voicecall.initiate",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const mode =
            params?.mode === "notify" ||
            params?.mode === "conversation" ||
            params?.mode === "realtime-conversation"
              ? params.mode
              : undefined;
          const message = normalizeOptionalString(params?.message) ?? "";
          if (!message && mode !== "realtime-conversation") {
            respond(false, { error: "message required" });
            return;
          }
          const rt = await ensureRuntime();
          const to = normalizeOptionalString(params?.to) ?? rt.config.toNumber;
          if (!to) {
            respond(false, { error: "to required" });
            return;
          }
          await initiateCallAndRespond({
            rt,
            respond,
            to,
            message: message || undefined,
            mode,
            realtimeConfig: params?.realtimeConfig as Record<string, unknown> | undefined,
          });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "voicecall.continue",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          await respondToCallMessageAction({
            requestParams: params,
            respond,
            action: (request) => request.rt.manager.continueCall(request.callId, request.message),
            failure: "continue failed",
            includeTranscript: true,
          });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "voicecall.speak",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          await respondToCallMessageAction({
            requestParams: params,
            respond,
            action: (request) => request.rt.manager.speak(request.callId, request.message),
            failure: "speak failed",
          });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "voicecall.end",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const callId = normalizeOptionalString(params?.callId) ?? "";
          if (!callId) {
            respond(false, { error: "callId required" });
            return;
          }
          const rt = await ensureRuntime();
          const result = await rt.manager.endCall(callId);
          if (!result.success) {
            respond(false, { error: result.error || "end failed" });
            return;
          }
          respond(true, { success: true });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "voicecall.status",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const raw =
            normalizeOptionalString(params?.callId) ?? normalizeOptionalString(params?.sid) ?? "";
          if (!raw) {
            respond(false, { error: "callId required" });
            return;
          }
          const rt = await ensureRuntime();
          const call = rt.manager.getCall(raw) || rt.manager.getCallByProviderCallId(raw);
          if (!call) {
            respond(true, { found: false });
            return;
          }
          respond(true, { found: true, call });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "voicecall.start",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const to = normalizeOptionalString(params?.to) ?? "";
          const message = normalizeOptionalString(params?.message) ?? "";
          if (!to) {
            respond(false, { error: "to required" });
            return;
          }
          const rt = await ensureRuntime();
          await initiateCallAndRespond({
            rt,
            respond,
            to,
            message: message || undefined,
          });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerTool({
      name: "voice_call",
      label: "Voice Call",
      description: "Make phone calls and have voice conversations via the voice-call plugin.",
      parameters: VoiceCallToolSchema,
      async execute(_toolCallId, params) {
        const json = (payload: unknown) => ({
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          details: payload,
        });

        try {
          const rt = await ensureRuntime();

          if (typeof params?.action === "string") {
            switch (params.action) {
              case "initiate_call": {
                const mode =
                  params.mode === "notify" ||
                  params.mode === "conversation" ||
                  params.mode === "realtime-conversation"
                    ? params.mode
                    : undefined;
                const message = normalizeOptionalString(params.message) ?? "";
                if (!message && mode !== "realtime-conversation") {
                  throw new Error("message required");
                }
                const to = normalizeOptionalString(params.to) ?? rt.config.toNumber;
                if (!to) {
                  throw new Error("to required");
                }
                const result = await rt.manager.initiateCall(to, undefined, {
                  message: message || undefined,
                  mode,
                  realtimeConfig: params.realtimeConfig as Record<string, unknown> | undefined,
                });
                if (!result.success) {
                  throw new Error(result.error || "initiate failed");
                }
                return json({ callId: result.callId, initiated: true });
              }
              case "continue_call": {
                const callId = normalizeOptionalString(params.callId) ?? "";
                const message = normalizeOptionalString(params.message) ?? "";
                if (!callId || !message) {
                  throw new Error("callId and message required");
                }
                const result = await rt.manager.continueCall(callId, message);
                if (!result.success) {
                  throw new Error(result.error || "continue failed");
                }
                return json({ success: true, transcript: result.transcript });
              }
              case "speak_to_user": {
                const callId = normalizeOptionalString(params.callId) ?? "";
                const message = normalizeOptionalString(params.message) ?? "";
                if (!callId || !message) {
                  throw new Error("callId and message required");
                }
                const result = await rt.manager.speak(callId, message);
                if (!result.success) {
                  throw new Error(result.error || "speak failed");
                }
                return json({ success: true });
              }
              case "end_call": {
                const callId = normalizeOptionalString(params.callId) ?? "";
                if (!callId) {
                  throw new Error("callId required");
                }
                const result = await rt.manager.endCall(callId);
                if (!result.success) {
                  throw new Error(result.error || "end failed");
                }
                return json({ success: true });
              }
              case "get_status": {
                const callId = normalizeOptionalString(params.callId) ?? "";
                if (!callId) {
                  throw new Error("callId required");
                }
                const call =
                  rt.manager.getCall(callId) || rt.manager.getCallByProviderCallId(callId);
                return json(call ? { found: true, call } : { found: false });
              }
              case "monitor_call": {
                const callId = normalizeOptionalString(params.callId) ?? "";
                if (!callId) {
                  throw new Error("callId required");
                }

                const pollIntervalMs = 3000;
                const maxWaitMs = rt.config.maxDurationSeconds * 1000 + 30_000;
                const deadline = Date.now() + maxWaitMs;

                while (Date.now() < deadline) {
                  const call = rt.manager.getCall(callId);
                  if (!call) {
                    throw new Error(`Call ${callId} not found`);
                  }
                  if (TerminalStates.has(call.state)) {
                    return json({ completed: true, call });
                  }
                  await new Promise((r) => setTimeout(r, pollIntervalMs));
                }

                const finalCall = rt.manager.getCall(callId);
                return json({
                  completed: false,
                  timedOut: true,
                  call: finalCall ?? null,
                });
              }
            }
          }

          const mode = params?.mode ?? "call";
          if (mode === "status") {
            const sid = normalizeOptionalString(params.sid) ?? "";
            if (!sid) {
              throw new Error("sid required for status");
            }
            const call = rt.manager.getCall(sid) || rt.manager.getCallByProviderCallId(sid);
            return json(call ? { found: true, call } : { found: false });
          }

          const to = normalizeOptionalString(params.to) ?? rt.config.toNumber;
          if (!to) {
            throw new Error("to required for call");
          }
          const result = await rt.manager.initiateCall(to, undefined, {
            message: normalizeOptionalString(params.message),
          });
          if (!result.success) {
            throw new Error(result.error || "initiate failed");
          }
          return json({ callId: result.callId, initiated: true });
        } catch (err) {
          return json({
            error: formatErrorMessage(err),
          });
        }
      },
    });

    api.on("before_prompt_build", async () => {
      if (!config.enabled || !config.useSubagent) {
        return undefined;
      }
      const realtimeEnabled = config.realtime.enabled;
      const lines: string[] = [
        "## Voice Call — Subagent Pattern",
        "Only spawn the subagent at the moment you are ready to invoke voice_call. Do all planning, parameter gathering, and confirmation in the main agent first. Do not spawn the subagent to plan, draft, or decide on a call.",
        "",
        "The subagent's sole responsibility is to proxy one voice_call invocation and monitor it to completion:",
        "1. Call voice_call with action=initiate_call using the exact parameters you pass in.",
        "2. Take the returned callId and immediately call voice_call with action=monitor_call to block until the call reaches a terminal state.",
        "3. Return the final call result (transcript, outcome, duration, action items) to the parent agent.",
        "The subagent must not deviate, retry independently, re-plan, or make additional voice_call invocations beyond this proxy+monitor flow.",
        "",
        "When spawning via sessions_spawn, pass the subagent every voice_call initiate_call parameter it needs to forward verbatim:",
        "- to: destination phone number in E.164 (omit to use the configured default toNumber)",
        "- message: intro/opening message (required unless mode is realtime-conversation)",
        "- mode: one of notify | conversation | realtime-conversation",
        "- realtimeConfig: { instructions: string } — required when mode is realtime-conversation",
        "",
        "Instruct the subagent to pass these through to voice_call initiate_call unchanged, then run monitor_call with the returned callId and summarize the terminal call result.",
      ];

      if (realtimeEnabled) {
        const defaultRealtimeInstructions =
          typeof config.realtime.instructions === "string"
            ? config.realtime.instructions.trim()
            : "";
        lines.push(
          "",
          "### Realtime voice is enabled",
          'Realtime voice-to-voice is configured for this plugin. You MUST set mode="realtime-conversation" on the initiate_call the subagent forwards, and you MUST supply a complete realtimeConfig.instructions string tailored to this specific call (persona, goals, constraints, tool-use rules, hang-up conditions). Do not rely on the subagent to write or expand these instructions — compose the full realtime instructions in the parent agent and pass them through verbatim.',
          "The message parameter is optional in realtime-conversation mode; the realtimeConfig.instructions drive the conversation.",
        );
        if (defaultRealtimeInstructions.length > 0) {
          lines.push(
            "",
            "Default realtime instructions configured for this plugin (treat as a baseline and extend for the current call):",
            "```",
            defaultRealtimeInstructions,
            "```",
          );
        }
      }

      return {
        appendSystemContext: lines.join("\n"),
      };
    });

    api.registerCli(
      ({ program }) =>
        registerVoiceCallCli({
          program,
          config,
          ensureRuntime,
          logger: api.logger,
        }),
      { commands: ["voicecall"] },
    );

    api.registerService({
      id: "voicecall",
      start: async () => {
        if (!config.enabled) {
          return;
        }
        try {
          await ensureRuntime();
        } catch (err) {
          api.logger.error(`[voice-call] Failed to start runtime: ${formatErrorMessage(err)}`);
        }
      },
      stop: async () => {
        if (globalState[VOICE_RUNTIME_STOP_PROMISE_KEY]) {
          await globalState[VOICE_RUNTIME_STOP_PROMISE_KEY];
          return;
        }
        const capturedPromise = globalState[VOICE_RUNTIME_PROMISE_KEY];
        const capturedRuntime = globalState[VOICE_RUNTIME_KEY];
        if (!capturedPromise && !capturedRuntime) {
          return;
        }
        globalState[VOICE_RUNTIME_PROMISE_KEY] = null;
        globalState[VOICE_RUNTIME_KEY] = null;
        const stopPromise = (async () => {
          const rt = capturedRuntime ?? (await capturedPromise!);
          await rt.stop();
        })();
        globalState[VOICE_RUNTIME_STOP_PROMISE_KEY] = stopPromise;
        try {
          await stopPromise;
        } finally {
          if (globalState[VOICE_RUNTIME_STOP_PROMISE_KEY] === stopPromise) {
            globalState[VOICE_RUNTIME_STOP_PROMISE_KEY] = null;
          }
        }
      },
    });
  },
});
