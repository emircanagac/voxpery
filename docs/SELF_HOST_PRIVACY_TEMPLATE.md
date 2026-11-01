# Self-Hosted Privacy Notice Template

This is an operator checklist and drafting template, not legal advice. The official hosted-service notices do **not** cover third-party self-hosted deployments.

Before opening a deployment to users, replace every bracketed item and obtain jurisdiction-specific advice:

1. Controller identity, physical/legal contact, privacy contact, and any representative/DPO.
2. Exact data categories and purposes enabled in that deployment.
3. Legal bases, age/guardian rules, and any optional consent flows.
4. Hosting region, subprocessors, email/OAuth/GIF providers, DPAs, and international-transfer safeguards.
5. Retention periods for accounts, content, logs, backups, moderation, and legal holds.
6. Clear notice that messages/DMs/attachments are server-readable until E2E encryption is implemented.
7. Data-subject request, export, correction, deletion, objection, complaint, and incident-report channels.
8. Terms/notice versioning and proof of the versions shown at registration.
9. Local rules such as KVKK, GDPR/ePrivacy, 5651, VERBİS, consumer law, and child-safety requirements.

Publish the finished documents and name them in the server environment: `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `LEGAL_KVKK_URL` (http or https) and `LEGAL_DOCUMENTS_VERSION` (up to 32 letters, digits, `.`, `-` or `_`). Registration and the acknowledgement prompt then link these documents, and the server asks everyone to acknowledge them again whenever the version changes. Until a document is named, its page says that the operator has not published it. Voxpery's hosted documents are never shown on a self-hosted server, and updates to them do not change what its users acknowledged.

Self-host operators must not present Voxpery's hosted-service operator as their controller.
