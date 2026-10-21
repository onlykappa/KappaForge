# Cloud coding acceptance

- **Owner authorization** – The change is performed under explicit owner consent, documented in the request metadata.
- **GitHub Actions execution** – CI pipelines will run the standard test suite and lint checks to ensure the repository remains healthy.
- **Authenticated gateway inference** – The integration relies on the authenticated inference route (`groq:openai/gpt-oss-120b`) configured in the system, guaranteeing secure model access.
- **Independent validation and a draft PR** – After committing, a draft pull request is opened for review; no automatic merge or deployment occurs until validation is confirmed.