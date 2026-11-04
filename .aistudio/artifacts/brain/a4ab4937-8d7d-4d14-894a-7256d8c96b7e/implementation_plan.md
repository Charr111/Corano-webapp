# Cloudflare R2 Image Migration, Client-Side Auto-Shrink Upload & Dynamic Admin Manager

This upgrade transitions **Corano Restaurant (`restocorano.com`)** from Cloudinary to permanent, zero-egress **Cloudflare R2 storage (`https://image.restocorano.com`)**, adds an iOS/mobile-safe **Client-Side Image Auto-Shrink (`< 55 KB`)** direct photo uploader to the Admin Dashboard, and introduces a **Dynamic Admin Gmail Access Manager** backed by Firebase Firestore while preserving 100% of the existing public menu design, typography, animations, and offline caching.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> All core architectural and operational requirements have been confirmed and locked in:

- **Confirmed Decision 1 — Cloudflare R2 Custom Domain & Bucket**: All new and migrated menu images are stored in the `corano-images` R2 bucket under the `items/` prefix and served publicly via `https://image.restocorano.com/items/...` with `Cache-Control: public, max-age=31536000, immutable`.
- **Confirmed Decision 2 — Strict Firestore Schema & Payload Sanitization**: Menu items in Firestore database `ai-studio-coranomenuwebsit-a4ab4937-8d7d-4d14-894a-7256d8c96b7e` strictly retain the `img` field name (never `image` or `imageUrl`) and string `category` field. All outgoing Firestore writes strip `undefined` properties and local `id` keys before saving.
- **Confirmed Decision 3 — Temporary Migration Unlock & Root + Dynamic Admin Access**: Admin access and Firestore write rules on menu collections are temporarily unlocked so the Cloudinary-to-R2 migration can run without sign-in friction. Permanent Root Admins are set to `apolokor@gmail.com` and `rony.daou83@gmail.com`, paired with a live **Admin Access Manager** panel allowing any authorized admin to grant or revoke Admin access for additional Gmail accounts via the `admins` collection.
- **Confirmed Decision 4 — Deduplicated, Collision-Proof Batch Migration**: Shared Cloudinary URLs (such as S/M/L portion sizes sharing one photo) are compressed and uploaded to R2 only once, while items sharing the same title across different categories (such as `"Kabab"` in `mashewe` vs. `"Kabab"` in `sajj`) receive unique `{category}-{docId}-{sanitizedTitle}` object keys so no photo is ever overwritten.

---

### 1. Overview & Core Concept

- **What It Does**:
  1. **Direct Mobile & Desktop Photo Upload with Auto-Shrink**: Enables restaurant administrators to pick any camera or gallery photo (`1.2 MB – 5 MB+`) directly inside the Admin Dashboard, automatically shrinking it in the browser to `~30 KB – 55 KB` (with full iOS Safari/WebKit compatibility) before uploading it to Cloudflare R2 and populating the item's `img` URL.
  2. **Automated & Interactive Cloudinary → R2 Migration Suite**: Provides both an interactive 4-step Admin Migration Manager panel (JSON Backup & Restore, Read-Only Dry-Run Report, Single-Item Live Test, and Resumable 30-Item Batch Migration with real-time progress) and automated backend migration execution.
  3. **Dynamic Admin Access Manager**: Lets signed-in admins view the permanent Root Admins (`apolokor@gmail.com` and `rony.daou83@gmail.com`) and add or remove additional admin Gmail addresses in real time.
- **Target Audience / Persona**: Corano Restaurant owners and managers updating menu items from mobile phones or laptops, and thousands of monthly restaurant guests browsing `restocorano.com` with instant image loading.
- **Key Value**: Eliminates Cloudinary bandwidth limits forever at $0 egress cost, guarantees sub-55 KB fast-loading menu imagery across all devices, prevents accidental image collisions or duplicates, and enables self-service admin team management.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  - **Flow 1 — Uploading or Replacing an Item Photo in Admin**:
    1. In the Admin Dashboard (`Items` tab, inside both the **Add New Item** form and the **Edit Item** modal), the existing `Image URL` text field remains fully editable for manual pasting.
    2. Right beside the `Image URL` input sits an **Upload Photo** action button connected to a device file picker.
    3. Selecting a photo displays `"Shrinking & Uploading..."` while the browser downscales and encodes the image under 55 KB, uploads it to Cloudflare R2 (`https://image.restocorano.com/items/...`), deletes the item's old R2 object if one is being replaced, fills the `img` field automatically, persists the change if editing an existing item, and displays a confirmation readout: `✓ Shrunk 1420 KB → 41 KB`.
  - **Flow 2 — Migrating Existing Cloudinary Images to R2**:
    1. At the top of the Admin Dashboard sits the **Cloudflare R2 Image Migration Manager** card displaying live R2 connection readiness and current item counts (Total Items, On R2, Remaining on Cloudinary).
    2. **Step 1 (`1. Download JSON Backup` / `Restore Backup`)**: Exports all current menu items and categories as a timestamped JSON snapshot for instant 1-click rollback.
    3. **Step 2 (`2. Run Dry-Run Check`)**: Scans all menu items without modifying data, reporting total items, items still on Cloudinary, items already on `image.restocorano.com`, unique vs. shared/deduplicated URLs, and sample `Cloudinary → R2` key mappings.
    4. **Step 3 (`3. Test 1 Item`)**: Migrates a single Cloudinary item end-to-end, showing the live clickable `https://image.restocorano.com/items/...` link and exact KB reduction.
    5. **Step 4 (`4. Migrate Next Batch (30 Items)` / `4. Migrate Final X Remaining Items`)**: Processes items in safe batches with a live progress bar (`Migrating 12 / 30 complete... (Currently optimizing: {title})`), a completion banner (`✅ Batch Completed!`), and a final celebration state (`🎉 All Menu Items 100% Migrated to Cloudflare R2!`).
  - **Flow 3 — Managing Admin Gmail Accounts**:
    1. Inside the Admin Dashboard, the **Admin Access Manager** section lists permanent Root Admins (`apolokor@gmail.com`, `rony.daou83@gmail.com`) alongside dynamically authorized Gmail accounts fetched from Firestore.
    2. Entering a Gmail address and clicking **Add Admin Gmail** normalizes the email to lowercase, writes the record to Firestore, and immediately grants that account admin privileges. Clicking **Remove** revokes dynamic access in one click.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Zero visual changes to the public restaurant experience (`Home`, `Menu`, `About`, `Reviews`). The new Admin Dashboard panels integrate seamlessly into Corano's existing dark charcoal and warm gold aesthetic.
  - *Color Palette & Mood*: Uses the existing semantic surface and accent tokens (`bg-background`, `bg-surface-container-low`, `bg-surface-container`, `text-primary` `#E4CD86`, `text-on-surface`, `text-on-surface-variant`, `border-outline-variant/30`, and `text-error`).
  - *Typography & Hierarchy*: Preserves `Noto Serif` (`font-headline`) and `Anton` on public pages without modification, and uses `font-mono tabular-nums` for byte size reductions, batch counters, and item order indices in the Admin console.
  - *Component Styling & Layout*: Single-elevation flat cards with `1px` subtle borders (`border-outline-variant/30`), clean single-line action buttons (`whitespace-nowrap shrink-0`), and unboxed typographic metadata separators (`·`) for compression and migration metrics.
- **Interactive Feedback & Motion**: Existing Framer Motion layout and modal transitions on the public menu remain untouched; Admin upload and batch migration buttons provide immediate `<= 200ms` state feedback, progress bars, and clear inline status messages without blocking browser dialogs.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Dual-Format Parallel Canvas Encoding for iOS Safari / WebKit**:
  - *Chosen Approach*: Downscale proportionally (`max 600px`, never upscaling) on an HTML5 `<canvas>`, encode both `image/webp` and `image/jpeg` in parallel, strictly verify `blob.type === 'image/webp'` to reject silent iOS PNG fallbacks, pick the smaller result, and step down quality (`0.72 → 0.62 → 0.52 → 0.44 → 0.36`) plus `0.82x` dimension scaling if needed until the file is `<= 55 KB`.
  - *Why*: iPhones running Safari or WebKit frequently ignore WebP quality parameters or silently output 400 KB+ PNGs. Testing both formats in parallel guarantees every phone upload lands between 30 KB and 55 KB.
- **Decision 2 — Dual Runtime R2 Upload Support (Development Express Server + Zero-Dependency Cloudflare Pages Function)**:
  - *Chosen Approach*: Provide `/api/r2-upload` and `/api/r2-status` in the Node/Express server using the S3 client for the development and migration environment, and pair it with a zero-dependency Cloudflare Pages Function using standard Web Crypto AWS Signature V4 (and native R2 binding support) for production deployments on `restocorano.com`.
  - *Why*: Avoids bundling Node-specific SDK dependencies into Cloudflare Pages Edge Functions, ensuring `vite build` and GitHub deployments to Cloudflare Pages succeed with zero build errors.
- **Decision 3 — URL-Keyed Deduplication + `{category}-{docId}-{slug}` Object Naming**:
  - *Chosen Approach*: Deduplicate migrations by normalized source Cloudinary URL while naming R2 objects `items/{category}-{docId}-{sanitizedTitle}.{ext}`.
  - *Why*: Prevents uploading duplicate copies when S/M/L items share a single photo, while guaranteeing items with identical names in different categories (e.g., `"Kabab"` in `mashewe` vs. `"Kabab"` in `sajj`) never overwrite one another.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        PUBLIC & ADMIN CLIENT (React SPA)                     │
│                                                                              │
│  ┌──────────────────────────┐    ┌────────────────────────────────────────┐  │
│  │ Public Views (Untouched) │    │ Admin Dashboard (/admin)               │  │
│  │ • Home / Menu / About    │    │ • Admin Access Manager (Root + Dynamic)│  │
│  │ • Reviews                │    │ • R2 Migration Manager (4-Step Suite)  │  │
│  │ • IndexedDB Local Cache  │    │ • Add & Edit Item Photo Uploader       │  │
│  └────────────┬─────────────┘    └───────────────────┬────────────────────┘  │
│               │                                      │                       │
│               │                          ┌───────────▼───────────┐           │
│               │                          │ Client Auto-Shrink    │           │
│               │                          │ • Max 600px c_limit   │           │
│               │                          │ • WebP vs JPEG < 55KB │           │
│               │                          └───────────┬───────────┘           │
└───────────────┼──────────────────────────────────────┼───────────────────────┘
                │                                      │
                │ Firestore SDK                        │ POST /api/r2-upload
                │ (Sanitized Payloads)                 │ GET  /api/r2-status
                ▼                                      ▼
┌───────────────────────────────┐      ┌───────────────────────────────────────┐
│      FIREBASE FIRESTORE       │      │     R2 UPLOAD GATEWAY (/api/r2-*)     │
│  • menuItems (img, category)  │      │  • Dev Server (S3 Compatible Client)  │
│  • menuCategories             │      │  • Cloudflare Pages Edge Function     │
│  • reviews                    │      │  • Auto-Delete Replaced R2 Object     │
│  • admins/{email}             │      │  • Immutable 1-Year Cache Headers     │
└───────────────────────────────┘      └───────────────────┬───────────────────┘
                                                           │ PUT / DELETE Object
                                                           ▼
                                       ┌───────────────────────────────────────┐
                                       │     CLOUDFLARE R2 (corano-images)     │
                                       │  • https://image.restocorano.com      │
                                       │  • Key: items/{cat}-{id}-{slug}.{ext} │
                                       └───────────────────────────────────────┘
```

- **Data Model & State**:
  - **`menuItems` Collection**: `{ category: string, title: string, price: string, desc: string, img: string, available?: boolean, addons?: string[], order?: number, isNew?: boolean }`. Outgoing writes pass through a sanitizer that removes `id` and any `undefined` keys.
  - **`menuCategories` Collection**: `{ name: string, order: number }`.
  - **`admins` Collection**: Document ID is the normalized lowercase email (`admins/{email}`), storing `{ email: string, addedBy: string, createdAt: string }`.
  - **Migration Deduplication Store**: Persisted in `localStorage` (`corano_r2_migration_map`) mapping normalized source Cloudinary URLs to their uploaded `https://image.restocorano.com/items/...` URLs across batches.

- **Interactive Component & State Mapping**:
  - **Admin Access Gate & Temporary Unlock**: Supports temporary open access in Admin Mode and Firestore rules during migration, while checking Root Admins (`apolokor@gmail.com`, `rony.daou83@gmail.com`) and the `admins` collection for permanent role enforcement.
  - **Item Photo Upload Handler**: Reads the selected file, invokes the `< 55 KB` canvas compressor, sends `{ fileName, contentType, base64Data, oldImageUrl }` to `/api/r2-upload`, updates `newItem.img` or `editingItem.img` (and saves to Firestore when editing an existing item), and renders `✓ Shrunk {originalSizeKB} KB → {compressedSizeKB} KB`.
  - **Migration Controls**:
    - *Backup / Restore*: Serializes `menuItems` and `menuCategories` to a downloadable `.json` file and restores documents via batched sanitized writes when a backup file is selected.
    - *Dry-Run Scanner*: Computes total items, Cloudinary count, R2 count, unique vs. shared Cloudinary URLs, and sample target keys without mutating Firestore or R2.
    - *Single-Item & Batch Runner*: Fetches each Cloudinary image with `f_auto,q_auto,w_600,c_limit` and `?migration_fetch=1` (`cache: 'no-store'`), compresses it via the `< 55 KB` pipeline, uploads once per unique source URL to R2, updates `img` in Firestore, and updates live progress (`Migrating X / Y complete...`) until 0 Cloudinary items remain.
