# Cloudflare R2 Database Migration & Instant Menu Engine

Migrate all live database operations—menu items, categories, customer reviews, global store currency settings (`$ USD` ↔ `L.L.`), and dynamic Admin Gmails—from Firebase Firestore to the existing Cloudflare R2 bucket (`corano-images` / `https://images.restocorano.com`), while keeping Google Sign-In (`firebase/auth`) for Admin authentication and preserving 100% of the website's visual design and Admin Dashboard features.

## User Review & Critical Decisions

> [!IMPORTANT]
> All requirements and architectural choices below have been aligned and confirmed. Zero visual, font, color, or layout changes will be made to either the public website or the Admin Dashboard.

- **Confirmed Decision 1 — Zero Frontend or Admin Visual Changes**: The public pages (`Home`, `Menu`, `About`, `Reviews`) and the mobile/desktop Admin Dashboard (`/admin`) retain their exact colors (`#E4CD86` gold and `#101010` / `#1a1a1a` / `#242424` dark surfaces), typography (`Noto Serif`, `Anton`, `Manrope`), animations, and existing R2 image URLs.
- **Confirmed Decision 2 — Pre-Migration Live Data Seed**: All 163 menu items, categories, customer reviews, currency settings, and admin accounts currently in Firestore will be exported and uploaded directly into Cloudflare R2 (`data/store-data.json`) alongside a local fallback snapshot so zero data can ever be lost.
- **Confirmed Decision 3 — Atomic Server-Side Action Patching (Multi-Admin Safe)**: Instead of overwriting the entire database from the browser, every admin action (`saveItem`, `toggleItemStock`, `deleteItem`, `saveCategory`, `deleteCategory`, `updateSettings`, review moderation, and admin Gmail management) patches only that single record on the server and increments the `version` timestamp.
- **Confirmed Decision 4 — Smart Client Cache + 1-Second Live Updates**: Customer browsers cache the ~40 KB menu data locally for instant **0ms** page loads and **0ms** category tab switching (no loading spinners between categories), while checking the R2 `version` in the background so price changes or Out-of-Stock toggles appear within **1 second**.

---

## 1. Overview & Core Concept

- **What It Does**: Replaces per-document Firestore reads/writes with a unified, server-managed JSON database object (`data/store-data.json`) stored in your Cloudflare R2 bucket (`corano-images`), served and updated through a dual-environment backend endpoint (`/api/r2-data`).
- **Target Audience / Persona**:
  - **Public Customers**: Experience instant menu browsing and instant switching across all categories with zero loading spinners.
  - **Restaurant Admins**: Continue using the exact same desktop and mobile-optimized Admin Dashboard (`/admin`) with Google Sign-In, live R2 photo auto-shrink + upload, Out-of-Stock switches, `$ USD` ↔ `L.L.` currency toggles, delete confirmations, and 1-click JSON database backup.
- **Key Value**: Eliminates Firebase Firestore daily read quota limits (reducing 175 reads per customer down to 0 Firebase reads and 1 lightweight R2 read), supporting hundreds of thousands of monthly visitors at **$0.00 cost**.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Customer Menu Browsing (`/menu`)**: Opens immediately from local cache (`0ms`) while verifying the latest R2 `version` in the background. Tapping between *Subs*, *Sajj*, *Mashewe*, *Salads*, or any newly added category (such as *Combo*) switches items instantaneously with zero spinners.
  2. **Customer Reviews (`/reviews`)**: Displays approved reviews (`status === 'approved'`) with `Rima issa` and `Eli Doueri` sorted at the end, and lets guests submit new reviews (`status: 'pending'`) directly to R2 for admin approval.
  3. **Admin Management (`/admin`)**: Admins sign in with Google, add/edit/delete categories and products, auto-shrink & upload photos to R2 (`< 55 KB`), flip In-Stock / Out-of-Stock switches, toggle `$ USD` ↔ `L.L.` prices, manage dynamic Admin Gmails, and download or restore full JSON backups.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Locked 1:1 to the existing Corano dark charcoal and warm gold aesthetic.
  - *Color Palette & Mood*: `--color-background: #101010`, `--color-surface-container-low: #1a1a1a`, `--color-surface-container: #242424`, and `--color-primary: #E4CD86`.
  - *Typography & Hierarchy*: Locked to `Noto Serif` headlines, `Anton` display buttons, and `Manrope` body/admin controls.
- **Interactive Feedback & Motion**: Preserves all existing Framer Motion transitions, bottom-sheet modals on iPhone/Android, delete confirmation dialogs, and status notices.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Atomic Delta Actions vs. Full-File Overwrites**
  - *Chosen Approach*: Server-side delta patching via `POST /api/r2-data`.
  - *Why*: Prevents race conditions if two admins edit different products simultaneously or if a customer submits a review at the exact moment an admin updates a price.
  - *Alternatives Considered*: Uploading the entire state from the client browser, which risks overwriting concurrent changes.
- **Decision 2 — Cryptographic Google ID Token Verification on the Server**
  - *Chosen Approach*: Verify the Firebase Auth `idToken` (`Authorization: Bearer <token>`) against Google's official token endpoint (`https://oauth2.googleapis.com/tokeninfo`) and check the email against Root Admins (`apolokor@gmail.com`, `rony.daou83@gmail.com`) and dynamic `admins[]` inside `store-data.json`.
  - *Why*: Requires zero extra secret keys in Cloudflare Pages while enforcing Google-grade authentication on every write/delete request.
- **Decision 3 — Smart `localStorage` Cache + `no-cache` Server Revalidation**
  - *Chosen Approach*: Render cached data immediately in the browser while fetching `/api/r2-data` with `Cache-Control: no-cache, must-revalidate`.
  - *Why*: Guarantees both instant initial rendering and immediate (< 1 second) propagation of price changes, currency switches, and Out-of-Stock toggles.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        PUBLIC & ADMIN FRONTEND (SPA)                       │
│                                                                            │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │   Public Menu View   │  │ Customer Reviews View│  │ Admin Dashboard  │  │
│  │  • 0ms Local Cache   │  │  • Approved Reviews  │  │ • Google Sign-In │  │
│  │  • Instant Category  │  │  • Public Review     │  │ • Stock Toggles  │  │
│  │    Tab Switching     │  │    Submission Form   │  │ • USD/LBP Switch │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────┬─────────┘  │
│             │                         │                       │            │
│             └─────────────────────────┼───────────────────────┘            │
│                                       ▼                                    │
│                      ┌─────────────────────────────────┐                   │
│                      │   R2 Data Client & Local Cache  │                   │
│                      │   (corano_r2_store_cache_v1)    │                   │
│                      └────────────────┬────────────────┘                   │
└───────────────────────────────────────┼────────────────────────────────────┘
                                        │
                    GET /api/r2-data    │    POST /api/r2-data (Delta Action
                    (No-Cache Live)     │    + Bearer Google ID Token)
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│          DUAL-ENVIRONMENT SERVER API (Dev Express + CF Pages Fn)           │
│                                                                            │
│  1. Verify Google ID Token (for Admin actions) against Root & Dynamic List │
│  2. Read latest data/store-data.json (or initialize from local seed)       │
│  3. Apply atomic delta action (saveItem, toggleStock, submitReview, etc.)  │
│  4. Increment version timestamp & write back to Cloudflare R2              │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│               CLOUDFLARE R2 BUCKET (corano-images)                         │
│                                                                            │
│  • data/store-data.json  (Categories, 163 Items, Reviews, Settings, Admins)│
│  • items/*               (163 Dish Photos + Logo + Page Backgrounds)       │
└────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State (`data/store-data.json`)

- `version` (`number`): Unix millisecond timestamp updated on every write.
- `updatedAt` (`string`): ISO timestamp of the latest modification.
- `settings`: `{ currency: 'USD' | 'LBP', exchangeRate: number }` (defaults to `USD` and `89000`).
- `categories` (`MenuCategory[]`): Sorted array of `{ id, name, order, description? }`.
- `items` (`MenuItem[]`): All 163+ menu items with `{ id, category, title, price, desc, img, available, addons?, order?, isNew? }`.
- `reviews` (`Review[]`): Customer reviews with `{ id, author, text, rating, date, status: 'pending' | 'approved' | 'rejected' }`.
- `admins` (`AdminUser[]`): Dynamically authorized admin Gmails `{ id, email, addedBy, createdAt }`.

### Interactive Component & State Mapping

| Action / Flow | Endpoint & Action | Server State Mutation & Validation |
| :--- | :--- | :--- |
| **Load Menu / Reviews** | `GET /api/r2-data` | Returns full store payload; client updates state & `localStorage` cache if `version` changed. |
| **Submit Guest Review** | `POST /api/r2-data` (`submitPublicReview`) | Validates `author`, `text`, and `rating` (1–5); appends review with `status: 'pending'`. |
| **Add / Edit Product** | `POST /api/r2-data` (`saveItem`) | Verifies Admin token; sanitizes payload; inserts or updates item by `id` in `items[]`. |
| **Flip Stock Switch** | `POST /api/r2-data` (`toggleItemStock`) | Verifies Admin token; toggles `available` boolean on target item `id` in `items[]`. |
| **Delete Item / Cat / Review** | `POST /api/r2-data` (`deleteItem` / `deleteCategory` / `deleteReview`) | Verifies Admin token after confirmation modal; removes record by `id`. |
| **Add / Edit Category** | `POST /api/r2-data` (`saveCategory`) | Verifies Admin token; inserts or updates category in `categories[]`. |
| **Switch Currency (`$` / `L.L.`)** | `POST /api/r2-data` (`updateSettings`) | Verifies Admin token; updates `settings.currency` and `settings.exchangeRate`. |
| **Approve / Reject Review** | `POST /api/r2-data` (`updateReviewStatus`) | Verifies Admin token; sets `status: 'approved' \| 'rejected'` on target review. |
| **Manage Admin Gmails** | `POST /api/r2-data` (`addAdminEmail` / `removeAdminEmail`) | Verifies Admin token; adds or removes normalized Gmail in `admins[]`. |
| **Backup / Restore JSON** | `POST /api/r2-data` (`restoreBackup`) | Downloads current `store-data.json` or restores uploaded JSON snapshot into R2. |
