---
name: auth-security
description: Analyze security-sensitive changes
---

# Analyze security-sensitive changes

Check authorization boundaries, input validation, secret handling, injection paths and failure behavior. Use approved test data; never expose real credentials or perform destructive security tests without authorization. Prefer fail-closed behavior and least necessary access. Distinguish a reproduced vulnerability from a theoretical risk. Implementation must remain inside the assigned scope and receive independent cross-vendor review before acceptance.
