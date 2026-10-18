# Local-Only Umbau — Löschplan (Branch `local-only`)

Ziel: rein lokales, freies Open-Source-Plugin. Einziger Modellpfad: OpenAI-kompatibler
 Lokalserver (llama.cpp llama-server, LM Studio, Ollama, jeder eigene Base-URL).
Keine Cloud, keine API-Keys, keine Lizenz, kein Tracking.

## Stage 1 — Lizenz/Entitlement-Cloud löschen
- src/entitlement/* (ganz)
- src/plusUtils.ts (+test)
- src/components/modals/CopilotPlusExpiredModal.tsx, CopilotPlusWelcomeModal.tsx
- src/components/PreviewUpsellHint.tsx
- src/components/ui/LicenseRequiredIcon.tsx
- src/settings/v2/components/PlusSettings.*
- src/lib/lockedCopilotEntries.*
- src/lib/productLinks.* (Marketing/UTM) + utils/usageCapError.* + USAGE_DASHBOARD_URL
- src/utils/reportUpload.brevilabs.* (Log-Upload), report-Aufrufe in AdvancedSettings
- src/modelManagement/setup/copilotPlus* + api.setup.copilotPlus + CopilotPlusSetupApi
- Settings-Felder: userId, plusLicenseKey, isPaidUser, isPlusUser, entitlementToken,
  entitlementExpiresAt, copilotPlusCatalog; Keychain-Retired-Ids aufräumen
- main.ts: syncPlus/verifyCachedEntitlement/checkIsPaidUser/Lizenz-Migrationszeilen
- chainRunner: Plus-Lizenzgates raus (CopilotPlusChainRunner:649, AutonomousAgentChainRunner:252,
  toolExecution isPlusOnly)
- utils.ts: Lizenz-Error-Mappings

## Stage 2 — Cloud-Provider löschen
- ChatModelProviders trimmen: OLLAMA, LM_STUDIO, OPENAI_FORMAT bleiben; Rest weg
  (OPENROUTERAI, OPENAI, ANTHROPIC, GOOGLE, XAI, GROQ, COPILOT_PLUS, MISTRAL, DEEPSEEK,
  COHEREAI, SILICONFLOW)
- BUILTIN_CHAT_MODELS -> [] (bzw. leer; lokale Modelle kommen aus modelManagement/Custom)
- ProviderInfo/ProviderSettingsKeyMap nur lokal
- chatModelManager: providerConfig/providerApiKeyMap/constructors nur lokal; keine Cloud-SDKs
- ChatOpenRouter.ts löschen; LM Studio + openai-format -> ChatLMStudio/ChatOpenAI
- anthropicAdapter, googleAdapter, listAnthropicModels, listGoogleModels,
  openaiCompatibleVerifyPath, CatalogDownloadService (models.dev!), AgentSetupApi? -> prüfen
- byokMigration etc.: provider-Mappings kürzen
- package.json: @langchain/anthropic, google-genai, groq, xai, deepseek, @google/generative-ai,
  openai (direkt), @langchain/ollama -> dependencies prüfen
- ConfigureProviderDialog: nur lokale Presets

## Stage 3 — Brevilabs-Tool-Cloud + selfHost-BYOK + YouTube/PDF
- src/LLMProviders/brevilabsClient.ts (+test) ganz
- src/LLMProviders/selfHostServices.ts (+test) ganz
- Tools: webSearch + youtubeTranscription aus builtinTools; SearchTools-Cloud-Teil;
  YoutubeTools.ts; YoutubeTranscriptModal; commands DOWNLOAD_YOUTUBE_SCRIPT
- cache/pdfCache (Brevilabs-Payloads) prüfen: FileParserManager Cloud-Zweige ->
  PDF/Docs/URL/YouTube-Attachment nicht unterstützt (klare Meldung), Markdown bleibt
- context/projectContextMaterializer createConverters Cloud-Zweige
- Mention.ts: url4llm/youtube Zweige
- openArtifacts komplett (Cloud-Publishing)
- settings: enableSelfHostMode, selfHostSearchProvider, firecrawl/perplexity/parallel/exa/
  supadata ApiKeys, docProcessorBackend, openAIProxyBaseUrl? (bleibt als generisches Feld? NEIN -> openai-format baseUrl deckt das ab)

## Stage 4 — Miyo + Agent-Mode (Claude/Codex/OpenCode) + Skills
- src/miyo/*, src/search/miyo/*, RetrieverFactory -> nur v3 lexical
- RelevantNotes Miyo-Pfad, MiyoSettings/Modal/StatusRow/ConnectionPanel
- src/agentMode/* komplett
- src/builtinSkills/* (nur Agent-Skills, Brevilabs-Shell-Skripte) -> prüfen
- ModePicker, CopilotMode, agentMode-Settings (AgentSettings.tsx, agentMode Settings-Shape),
  wireAgentModelDiscovery, slashMenuItems BackendId/Skill, CopilotView-Agent-Zweige
- commands + Tastaturbefehle für Agent entfernen

## Stage 5 — Netzwerk restlos + Doku
- releaseUpdateNotice + release-update/* + GitHub-Release-Fetch (kein externer Request)
- YouTube-Thumbnails i.ytimg.com (ChatSingleMessage)
- README/manifest/RELEASES.md/local_copilot.md/docs: lokal, deutsch/englisch,
  llama.cpp llama-server Anleitung (http://localhost:8080/v1)
- images/: Cloud-Screenshots ausmisten
- Einstellungen-Tabs: basic, command, advanced(+debug) — byok heißt "Lokale Modelle"

## Validate
- npm run build, npm run lint, npm run test nach jedem Stage
- settings migrations: Cloud-Migrations bleiben als Historie OK, aber nur wenn sie keine
  gelöschten Symbole importieren; sonst entfernen (fresh install Ansatz)
