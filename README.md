# Order Management API

Backend Express.js + Firebase Admin SDK cho hệ thống quản lý khách hàng, sản phẩm, đơn hàng và báo cáo doanh thu multi-tenant.

## Cấu hình

Copy `.env.example` thành `.env` và cấu hình Firebase Admin bằng một trong các cách:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS`

Các biến khác:

```env
PORT=3000
APP_TIMEZONE=Asia/Ho_Chi_Minh
CORS_ORIGINS=http://localhost:3001
AUTH_REQUIRED=true
AUTH_BYPASS_TENANT_ID=KCwvQrgxfgvnqla11eFI
AUTH_BYPASS_UID=local-bypass-user
SESSION_COOKIE_NAME=session
SESSION_MAX_AGE_MS=432000000
SESSION_COOKIE_SAMESITE=lax
INVENTORY_DEDUCTION_ENABLED=false
```

`INVENTORY_DEDUCTION_ENABLED=true` là mặc định để khi tạo/sửa order backend trừ tồn kho bằng transaction và optimistic locking trên field `version` của product. Đặt `false` chỉ khi muốn tạm không quản lý tồn kho.

Khi số lượng đặt vượt tồn kho, hoặc product đã bị request khác cập nhật trước đó, API trả HTTP `409`:

```json
{
  "message": "Số lượng không phù hợp.",
  "detail": {
    "productId": "product_001",
    "available": 0,
    "requested": 2
  }
}
```

## Tạm tắt authentication

Trong `.env` có một công tắc duy nhất:

```env
AUTH_REQUIRED=false
```

Khi `false`, các API bỏ qua Firebase Auth và role permission, dùng tenant mặc định trong `AUTH_BYPASS_TENANT_ID`. Khi triển khai thật, đổi lại:

```env
AUTH_REQUIRED=true
```

Sau khi đổi `.env`, cần restart backend. Chỉ dùng bypass trong môi trường tạm thời vì khi đó API có thể bị truy cập và ghi dữ liệu mà không cần đăng nhập.

`GET /api/health` trả về `authRequired` để kiểm tra nhanh trạng thái công tắc hiện tại. Nếu muốn giới hạn frontend khi bật auth, đổi `CORS_ORIGINS=*` về origin cụ thể, ví dụ `http://localhost:3001`.

## Chạy

```bash
npm.cmd install
npm.cmd start
```

API chạy tại `http://localhost:3000`.

## Firestore structure

Chỉ sử dụng Firestore database `(default)`. Không lưu business data vào subcollection của `tenants` và backend không ghi bất cứ document nào vào collection `tenants`. Các entity nằm ở collection gốc và luôn có `tenantId`:

```text
users/{uid}
tenants/{tenantId}                 # chỉ đọc để xác thực tenant
roles/{roleId}
clients/{clientId}
products/{productId}
orders/{orderId}
payments/{paymentId}
counters/{counterId}
idempotency/{key}
auditLogs/{logId}
```

Mỗi document trong `clients`, `products`, `orders`, `payments`, `counters`, `idempotency`, `auditLogs` đều có `tenantId`. `users/{uid}` phải có `tenantId`, `roleId`, `status: "active"`. `roles/{roleId}` phải có `tenantId`, `status: "active"` và `permissions`, ví dụ:

```json
{
  "status": "active",
  "permissions": [
    "client.view",
    "product.view",
    "order.view",
    "order.create",
    "order.update",
    "report.view"
  ]
}
```

## Authentication

1. Frontend đăng nhập Firebase Auth và nhận ID token.
2. Gọi `POST /api/auth/session` với `{ "idToken": "..." }`.
3. Backend tạo HttpOnly session cookie.
4. Các request tiếp theo dùng `credentials: "include"`.
5. Với request thay đổi dữ liệu (`POST`, `PUT`, `PATCH`, `DELETE`), đọc cookie `csrfToken` và gửi lại qua header `X-CSRF-Token`.

Ngoài session cookie, backend vẫn hỗ trợ `Authorization: Bearer <Firebase ID token>` để tương thích local/integration.

Endpoints auth:

```text
POST /api/auth/session
POST /api/auth/logout
GET  /api/auth/me
```

## API

```text
GET    /api/customers
POST   /api/customers
PUT    /api/customers/:id
DELETE /api/customers/:id

GET    /api/products
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id

GET    /api/orders
GET    /api/orders/:id
POST   /api/orders
PUT    /api/orders/:id
PATCH  /api/orders/:id/status
DELETE /api/orders/:id

GET    /api/reports/daily?days=7
GET    /api/health
```

Tất cả response thành công dùng dạng `{ "data": ... }`; lỗi dùng `{ "message": "...", "detail": ... }`. Tất cả status đều là lowercase và DELETE là soft delete.

### Tạo order

```json
{
  "clientId": "client_001",
  "items": [{ "productId": "product_001", "quantity": 2 }],
  "action": "confirm"
}
```

Có thể dùng `newClient`, `newProduct`, hoặc kết hợp record cũ/mới trong cùng request. Giá và tổng tiền luôn được đọc/tính ở backend. Gửi thêm header `Idempotency-Key` để chống tạo trùng khi request bị retry.

Backend tự sinh mã đơn theo dạng `clientCode-sku-datetime`, ví dụ `CUS001-SP001-20261118115630`. Thời gian dùng `Asia/Ho_Chi_Minh`; nếu một đơn có nhiều sản phẩm thì các SKU được nối bằng dấu `-`. Response trả cả `orderCode` và `code`.

### Đổi trạng thái order

```json
{ "status": "delivered" }
```

Chỉ cho phép `new -> delivered` hoặc `new -> cancelled`. Order `deleted` không xuất hiện trong list/report thông thường.
