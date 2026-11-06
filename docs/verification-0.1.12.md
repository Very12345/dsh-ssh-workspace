# 0.1.12 verification

On DSH 0.2.2-rc.1, a real isolated official Host reproduced the reported
sessionController unavailable failure after changing agent-default-model.
The Host and Our Free Model 2.8.0 were tested without live credentials,
conversation histories, or external fetches.

| Composition | Before model edit | After model edit |
| --- | --- | --- |
| Official base + web | active | active |
| Official + Our Free Model | active | active |
| Official + SSH 0.1.11 | active | sessionController and other services pending |
| Official + OFM + SSH 0.1.11 | active | same failure |
| Official + fixed SSH | active | active; no pending/failed services |
| Official + OFM + fixed SSH | active | active; no pending/failed services |

The fix changes only six private local-world entry IDs to use the SSH
namespace. It does not change the service implementations, remote mappings,
permissions, host core or other provider code. An attempted lifecycle refactor
was discarded: it restored sessionController but left terminal/process
dependencies pending, so it did not meet acceptance.

The shipped optional HMR smoke uses the installed official runtime, inspects
all loader entries, and alternates model selection four times. It checks that
sessionController stays active and that no enabled service remains pending or
failed. Optional provider integration is supported through explicit environment
paths. External fetch is blocked and model requests are not sent.

These tests establish this specific SSH/HMR compatibility failure and its fix;
they do not certify all optional plugins or upstream model availability.
