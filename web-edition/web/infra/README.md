# web/infra

- `docker-compose.dev.yml` — Postgres/Redis/Garage cho dev (chạy trực tiếp trên VPS, chỉ bind 127.0.0.1).
- `docker-compose.prod.yml` — stack production, deploy qua Dokploy.
- `garage-bootstrap.sh` — khởi tạo cluster Garage lần đầu (layout, bucket, access key). Idempotent.

## Khởi tạo Garage sau lần deploy đầu tiên

Chỉ cần khi volume `noteriv-prod-garagedata` mới tinh (deploy lần đầu, chuyển VPS, khôi phục thảm hoạ).
Cluster đang chạy bình thường thì không chạy lại.

```sh
docker ps | grep garage            # lấy tên container thật do Dokploy sinh
GARAGE_CONTAINER=<tên-container> sh web/infra/garage-bootstrap.sh
```

Dev: `GARAGE_CONTAINER=noteriv-garage GARAGE_CONFIG=/etc/garage.toml sh web/infra/garage-bootstrap.sh`

Script in `ATTACHMENTS_S3_ACCESS_KEY_ID` / `ATTACHMENTS_S3_SECRET_ACCESS_KEY` **một lần duy nhất**
khi vừa tạo key (Garage không cho xem lại secret). Đặt hai giá trị này vào Dokploy compose env rồi redeploy `noteriv-api`.
