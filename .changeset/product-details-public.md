---
"api": patch
"ui": patch
---

Show the Product Details box to shoppers. Provider field configs now live in a shared module the UI imports directly (formatters run when rendering), the admin-only `/admin/providers/field-configs` route is removed, and Printful sync stores its details under `providerDetails.printful` so they are no longer stripped.
