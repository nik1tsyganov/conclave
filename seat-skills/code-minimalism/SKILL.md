---
name: code-minimalism
description: Review correctness and unnecessary complexity
---

# Review correctness and unnecessary complexity

Trace the changed execution path and its callers. Prefer reuse, standard-library functions and simple local code over new frameworks. Never drop an explicit deliverable to make the patch smaller. Report reproducible defects with file/line references, impact and a narrow fix. In review mode, propose changes but do not make them. Keep security, error handling and regression evidence; do not shorten code by removing checks.
