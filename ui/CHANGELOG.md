# Changelog

## 1.11.0

### Minor Changes

- 79772b7: Add PostHog analytics integration

  - Add `posthog-js` dependency
  - Create `lib/posthog.ts` with `initPostHog()` and `captureEvent()` helpers
  - Track `add_to_cart` event on product page with product/variant details
  - Track `download` event on free download clicks
  - Configure build-time env var injection via `source.define` (`PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST`)
  - Add env vars to `.env.example`

  PostHog is disabled by default — set `PUBLIC_POSTHOG_KEY` in your environment to activate.

## 1.10.0

### Minor Changes

- fd43e99: Add fulfillment cost visibility and price locking to admin

  - Add cost/margin columns to inventory table
  - Add cost card to product edit sheet
  - Add price lock toggle to product edit

## 1.9.0

### Minor Changes

- d06fe44: Resolve Printful client rate limiting issues & re-introduce sync

## 1.8.0

### Minor Changes

- e0c9f1e: Add support for downloadable products with free download CTAs
- e0c9f1e: Add storage plugin system (R2/S3) with presigned upload flow, provider-agnostic placement support, and remote database backup/restore scripts

  - **Storage plugin**: New `api/src/services/storage/` with R2 and S3 provider implementations following the fulfillment plugin pattern. Supports presigned URL uploads (client uploads directly to storage), signed read URLs, and file deletion. Provider selection via `STORAGE_PROVIDER` env var (`"r2"` or `"s3"`).

  - **New API routes**: `POST /admin/assets/upload` (request presigned URL), `POST /admin/assets/upload/confirm` (finalize upload), `POST /admin/assets/{id}/signed-url` (read access), `POST /admin/fulfillment/placements` (provider-agnostic placement slots).

  - **Fulfillment `getPlacements`**: Each provider now exposes available placement slots. Printful returns product-specific placements (front, back, sleeves, etc.). Lulu returns book slots (cover, interior). No provider-specific conditionals — always routed through the provider contract.

  - **Asset schema**: Added `storage_key` and `size` columns to the assets table. Migration needs to be generated via `db:generate`.

  - **UI DesignStep refactor**: Replaced the flat asset list with a thumbnail grid, drag-and-drop file upload (presigned URL flow), placement dropdown populated from the provider's `getPlacements` endpoint, and a quick placement preview overlay on the catalog product image. Mockups auto-trigger after product creation via the provider contract.

  - **Remote backup/restore**: Added `db:backup:remote` and `db:restore:remote` scripts that accept a `DATABASE_URL` env var for backing up Railway Postgres before migrations.

## 1.7.0

### Minor Changes

- 881d65c: Add support for downloadable products with free download CTAs

## 1.6.0

### Minor Changes

- 857703a: Add country-aware phone number formatting on checkout

  - Added libphonenumber-js for international phone number parsing and formatting
  - Phone input now formats numbers based on selected country (e.g., US: +1 (234) 567-8900, UK: +44 20 1234 5678)
  - Dynamic placeholder updates when country is selected
  - Improved phone validation using libphonenumber-js country-specific rules

- 857703a: Add provider-specific product details display

  - Added ProductDetails component to display provider-specific details (GSM, material, page count, etc.)
  - Each fulfillment provider (Printful, Lulu) now exports field configurations for their product details
  - Added `getProviderFieldConfigs` API endpoint to fetch field configurations from providers
  - Updated sync flow to copy `providerDetails` from provider products to product metadata
  - Lulu products now include `pageCount` and `format` in their provider details
  - Printful products include `brand`, `model`, `gsm`, `material`, `techniques`, and `placements`

## 1.5.3

### Patch Changes

- 045bbb5: Fix Lulu shipping errors and improve error messages

  - Fix state code handling for international addresses (use ISO-3166-2 codes, 2-3 chars)
  - Convert technical Lulu API errors to user-friendly "Shipping is not available to this destination"
  - Remove "Lulu" branding from user-facing messages
  - Handle no shipping rates case with clear error message

## 1.5.2

### Patch Changes

- 487c667: Require phone number for Lulu book checkout and fail early with a clear validation error instead of crashing during order creation.

  - Validate provider-specific address requirements before quote and checkout on both UI and API
  - Remove misleading dummy phone fallback in Lulu cost calculation
  - Surface real validation errors to the user instead of generic 500s

## 1.5.1

### Patch Changes

- e6ebc1a: Add product-level referral sharing and checkout fee routing for PingPay purchases.

  - Add admin metadata controls for enabling referral sharing on specific products
  - Generate clean slug-based referral links from product pages and keep referral context in cart items
  - Append dynamic affiliate fees during PingPay checkout without changing listed storefront prices

## 1.5.0

### Minor Changes

- a853e28: Add Lulu fulfillment provider for print-on-demand books

  - Add LuluService with OAuth2 authentication and print-jobs API integration
  - Add config-driven Lulu book sync with configurable PDF and preview file metadata
  - Add shipping quote and tax/VAT aggregation support for mixed Printful and Lulu carts
  - Add Lulu webhook handling and provider configuration in admin UI
  - Generalize provider admin APIs so Printful and Lulu share the same webhook/test flow
  - Update environment configuration and product sync behavior for Lulu support

### Patch Changes

- f6ccc71: Improve admin order management with inline status updates, optional notes, and clickable status notes across order views.

## 1.4.2

### Patch Changes

- 273343b: Fix marketplace variant selection so single-color products auto-select correctly on product pages and quick add flows.
- 273343b: Add a mint link to the Legion SBT required label on gated product cards.
- 273343b: Remove creator fee rows from cart and checkout so those summaries only show amounts included before PingPay adds any extra fees.

## 1.4.1

### Patch Changes

- ea92005: Fix marketplace variant selection so single-color products auto-select correctly on product pages and quick add flows.
- ea92005: Add a mint link to the Legion SBT required label on gated product cards.

## 1.4.0

### Minor Changes

- b7807ab: Add exclusive products with fee splits and product metadata

  - Add `exclusive` boolean field to products for storefront filtering
  - Add `metadata` JSON field to products for creator account and fee splits
  - Add `/exclusives` route showing exclusive products
  - Add admin inventory editors for exclusive toggle and metadata configuration
  - Add PingPay fee support for checkout with creator royalties
  - Add database index on `exclusive` for query performance

- b7807ab: Move Legion purchase gating to product metadata and remove the legacy collection-exclusive flow

  - Add a `legion-holder` purchase gate plugin with NEAR holder checks and checkout enforcement
  - Add product metadata controls and storefront gating states for locked Legion products
  - Remove old collection-exclusive API, schema, and database support

- b7807ab: Add product metadata enrichment with Printful provider details and fee display on storefront

  - Extend ProductMetadataSchema with providerDetails.printful for brand/model/description/techniques/placements/GSM
  - Fetch catalog product details from Printful API during sync to enrich product metadata
  - Fix admin inventory metadata editor to use "Product Metadata" label and percentage inputs (converts to BPS)
  - Display fee percentage on product cards next to price
  - Show fee breakdown and provider facts on product detail page
  - Add creator fees line item to cart and checkout order summaries

### Patch Changes

- 89e5517: Improve admin order management with inline status updates, optional notes, and clickable status notes across order views.

## 1.3.1

### Patch Changes

- ff33a93: Fix: Make user context nullable and add defensive checks

  - Update API context schema to accept nullable user field, matching the actual data structure from the host
  - Add defensive null checks for loaderData.orders and items arrays in orders page
  - Fix tracking info checks to properly handle undefined/null values
  - Remove verbose hydration/dehydration console logging from router and hydrate modules

## 1.3.0

### Minor Changes

- a96433e: Add comprehensive order audit logging and admin order management

  **Database:**

  - Add `isDeleted` flag to orders table for soft delete support
  - Create `order_audit_logs` table to track all order changes

  **API Features:**

  - Add `getOrderAuditLog` endpoint for viewing order history (accessible by admins and order owners)
  - Add `updateOrderStatus` endpoint for admin manual status updates
  - Add `deleteOrders` endpoint for bulk delete with soft/hard delete logic
  - Add `requireAdmin` middleware for proper admin access control
  - Update API context schema to include user object with role

  **Admin Dashboard:**

  - Add row selection checkboxes for bulk actions using TanStack Table
  - Add "Delete Selected" button with confirmation modal showing draft vs non-draft breakdown
  - Add "View History" button per order showing full audit timeline
  - Replace alert() with proper toast notifications using sonner

  **User Experience:**

  - Add "Order Timeline" button in user's order list
  - Add "Order History" section in order confirmation page
  - Timeline shows status changes and tracking updates (filtered for users)

  **Audit Logging:**

  - Webhooks from Printful, Gelato, Stripe, and PingPay automatically log changes with `service:` prefix
  - Admin manual edits are logged with the admin's NEAR account
  - Non-draft deletions are soft-deleted and logged for audit purposes
  - Draft orders are hard-deleted permanently

  **Code Quality:**

  - Create shared `AuditLogViewer` component to eliminate code duplication
  - Fix React anti-pattern: use useEffect instead of useState for data fetching
  - Add proper error logging to gelato webhook catch block
  - Fix TypeScript type errors and remove unused imports
  - All type checks pass

- a96433e: Fix product sync pagination and add real-time progress tracking

  - Fix critical bug: Printful API was only fetching 20 products due to missing pagination
  - Add auto-pagination to fetch all products from Printful (was maxing at 20)
  - Add real-time sync progress via SSE with per-provider tracking
  - Add expandable per-provider progress view in admin dashboard
  - Add catalog variant caching to reduce API calls
  - Add parallel product fetching with concurrency limit (5 concurrent)
  - Add retry logic with exponential backoff for failed fetches
  - Add throttled progress updates (every 10 products) to reduce bandwidth
  - Limit provider concurrency to 2 to avoid rate limiting
  - Add `failed` count to sync results and display in completion toast
  - Simplify SSE handler from ~30 lines to ~15 lines using async generator
  - Consolidate types: SyncProgress now inferred from zod schema
  - Auto-clear progress 30 seconds after completion
  - Fix validation error: limit was 1000 but contract allowed max 100
  - Add continue-on-failure: failed providers show error, others continue
  - Update provider status to 'error' on failure with error message
  - Improve error messages: user-friendly instead of "Internal Server Error"
  - Fix frontend: invalidate syncStatus on error so UI updates correctly

- a96433e: Implement real-time product sync progress tracking with cancellation support

  **API Changes:**

  - Add SyncProgressStore with subscription-based real-time updates
  - Add SyncManager for managing active sync operations with Fiber-based concurrency
  - Add `subscribeSyncProgress` streaming endpoint for live progress updates
  - Add `cancelSync` endpoint to interrupt stuck sync operations
  - Implement heartbeat timeout detection (60s) for stale syncs
  - Add rate limiting for Printful API calls to prevent throttling
  - Update sync contract with progress types and cancellation support
  - Refactor Printful service to report granular sync progress per product

  **UI Changes:**

  - Add `useSyncProgress` hook for real-time sync state in admin dashboard
  - Add `cancelSync` mutation for manual sync interruption
  - Redesign inventory dashboard with live sync progress indicators
  - Display per-provider sync status, totals, and current product being synced
  - Add sync cancellation button for active operations
  - Show detailed error states and recovery actions for failed syncs

  This enables administrators to monitor product synchronization in real-time,
  identify bottlenecks, and recover gracefully from stuck operations.

- c9f0b04: Improve checkout UX with auto-calculation, form persistence, and better validation

  - Add form persistence to localStorage (24h expiry) to prevent data loss on page refresh
  - Auto-calculate shipping when all required fields are filled
  - Add field-level validation with inline error messages
  - Make pay button always visible with disabled state tooltips explaining why it's disabled
  - Enhance terms checkbox visibility and prominence with green accent and "Required" badge
  - Remove ~50 lines of manual validation code by using TanStack Form best practices
  - Provide immediate validation feedback on blur for all required fields

- a96433e: Add order_updated webhook support for Printful to update order status to shipped when Printful marks orders as fulfilled
- c9f0b04: Upgrade better-near-auth to 0.5.1 with single-step authentication

  - Update better-near-auth from 0.3.4 to 0.5.1
  - Update peer dependencies (@hot-labs/near-connect, near-kit, better-auth)
  - Rename 'domain' to 'recipient' in client config
  - Simplify auth flow from two-step to single-step
  - Remove requestSignIn.near() calls
  - Update error handling for new error codes
  - Single popup for supported wallets (Meteor, Intear)
  - Automatic fallback for unsupported wallets (HOT, MyNearWallet)
  - Client-generated nonces for improved security
  - Fixed "No accounts found" error in 0.5.0
  - Proper wallet selector display before authentication

### Patch Changes

- a96433e: Add missing product color mappings

  - Baby Blue: #89CFF0
  - Carbon Grey: #767873
  - Heather True Royal: #24509A
  - Hemp: #987D73
  - Navy Blazer: #282D3C
  - Pepper: #5D5951
  - True Navy: #3F5277

- c9f0b04: Fix wallet selector z-index conflicts by removing login dialog

  - Remove login dialog from marketplace header
  - Redirect to dedicated login page instead
  - Eliminate z-index conflicts between dialog overlay and wallet selector
  - Add redirect parameter to return users to original page after login
  - Remove duplicate sign-in logic from header
  - Delete unused sign-in-form component
  - Simplify codebase by ~60 lines
  - Improve mobile experience with full-page login

- bd6a274: ## Printful API V2 Migration & Sync Performance Improvements

  ### API Changes

  #### Migration to V2 API

  - **Catalog Variants**: Migrated from V1 to Printful V2 API
    - New `getCatalogVariantV2()` method with strategy-based configuration
    - New `getCatalogVariantsV2()` batch method with concurrency control (6 concurrent requests)
    - 3-second timeout for best-effort operations, 10-second for standard operations
    - Zero retries for best-effort, 2 retries for standard operations
    - Built-in circuit breaker protection

  #### V1 Sync Products Optimization

  - Reduced timeout from 30s → 10s with AbortController
  - Removed heavy retry logic (was 5 retries, now direct fetch)
  - Proper timeout error handling with clear messages

  #### Architecture Improvements

  - **Operation Strategies**: Defined three strategies for different use cases:

    - `critical`: 30s timeout, 5 retries (for orders)
    - `standard`: 10s timeout, 2 retries (for sync products)
    - `bestEffort`: 3s timeout, 0 retries (for catalog enrichment)

  - **Circuit Breaker Pattern**: Prevents cascade failures

    - Separate circuit breakers for V1, V2, and catalog APIs
    - Opens after 5 consecutive failures
    - Half-open state for gradual recovery
    - 1-minute timeout before retrying

  - **Structured Logging**: New `SyncLogger` class
    - Phase-based logging (init, fetch_products, sync_to_db, cleanup)
    - Progress tracking with rate limiting (logs every 5 seconds)
    - Individual product success/failure logging
    - Completion summary with timing

  #### Error Handling Improvements

  - New error types: `CatalogVariantError`, `SyncProductError`
  - Added `TIMEOUT` error code to `FulfillmentError`
  - Better error messages without stack traces for expected failures

  ### UI Changes

  #### Real-time Sync Progress

  - Live progress bar showing "Synced X of ~Y products"
  - Provider-specific status details
  - Auto-refreshing product table every 3 seconds during sync
  - Visual progress indicators with percentage complete

  #### React Performance Fix

  - Fixed React Error #185 (Maximum update depth exceeded)
  - Proper AbortController cleanup in SSE subscription
  - Removed infinite loop in `useSyncProgressSubscription`

  #### TanStack Query Integration

  - Native polling support with `refetchInterval`
  - Dynamic polling based on sync status
  - Proper cache management during sync operations

  ### Testing

  - All 70 API tests pass
  - All type checks pass (API + UI)
  - No breaking changes to existing API contracts

  ### Performance Impact

  - **Before**: 30s timeout + 5 retries = up to 150s per request
  - **After**: 10s timeout + proper batching = ~30s max for sync operations
  - **Before**: Sequential catalog variant fetches (N requests)
  - **After**: Batch V2 API with concurrency (6 concurrent requests)

  ### Migration Notes

  - Sync products remain on V1 API (no V2 endpoints available yet)
  - Catalog variants migrated to V2 API (faster, better rate limiting)
  - All changes are backward compatible
  - Existing tests updated to reflect new behavior

## 1.2.0

### Minor Changes

- 1d0a44e: Mobile dropdowns, grid icons, collections banner styling, UX improvements, and bug fixes

  - Added mobile dropdown navigation improvements to marketplace header
  - Implemented grid/list view toggle with icons (Square, Grid3x3) across product listings
  - Enhanced collections banner styling and page layouts
  - Added "View All" collection support with improved filtering and sorting options
  - Fixed mobile responsive spacing and layout issues on homepage
  - Improved product card and size selection modal UX
  - Added search and filter capabilities to collections pages
  - Fixed checkout and order confirmation page styling

## 1.1.0

### Minor Changes

- acee170: Add badge editing capability to collections admin panel - collections can now have customizable badge labels displayed on the homepage carousel

### Patch Changes

- acee170: Fix collections filter to use correct `useCollections()` API hook instead of deprecated `useCategories()`
- acee170: Fix collections filter not updating product results - added collectionFilter to useMemo dependencies and Clear All handler
- acee170: Fix mobile homepage lower box to display "Represent the NEAR protocol IRL" content instead of repeating carousel collection content
- acee170: Fix mobile products page single view to display all products in a single column instead of just one item
- acee170: Remove grid view toggle buttons from homepage - should only be available on the products page

## 1.0.0

### Major Changes

- 97e1666: v1 release of the merch store with printful fulfillment and pingpay payments

All notable changes to this package will be documented in this file.

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

## [0.1.0] - 2026-02-05

### Added

- Initial UI package structure
- Product marketplace pages
- User authentication flow
- Shopping cart functionality
- Checkout process
- Admin dashboard
- Profile management
- Responsive design with Tailwind CSS
