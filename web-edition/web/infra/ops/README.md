# ops: theo dõi máy chủ

`check-host.sh` chạy bằng cron trên VPS mỗi 10 phút. Nó ping healthchecks.io khi **đĩa ≤ 90%** và **RAM khả dụng ≥ 300MB**; ngược lại ping `<url>/fail` kèm số liệu. Không có tín hiệu quá chu kỳ + ân hạn (VPS chết, cron chết) thì healthchecks.io cũng gửi email.

Hướng dẫn cho chủ dự án (không chuyên): [`docs/ops/giam-sat.md`](../../../docs/ops/giam-sat.md).

## Cài đặt (trên VPS, bằng root)

```sh
# 1. script
install -m 755 check-host.sh /usr/local/bin/noteriv-check-host

# 2. cấu hình: URL ping của check "noteriv-host" trên healthchecks.io (KHÔNG commit vào git)
mkdir -p /etc/noteriv
umask 077
printf 'CHECK_HOST_URL=%s\n' 'https://hc-ping.com/<uuid>' > /etc/noteriv/check-host.env

# 3. cron
cat > /etc/cron.d/noteriv-check-host <<'EOF'
*/10 * * * * root /usr/local/bin/noteriv-check-host >> /var/log/noteriv-check-host.log 2>&1
EOF
chmod 644 /etc/cron.d/noteriv-check-host
```

Cấu hình check trên healthchecks.io: chu kỳ **10 phút**, ân hạn **10 phút**, gửi email.

## Thử

```sh
noteriv-check-host                         # in "check-host: ok (disk=..% mem_available=..MB)"
CHECK_HOST_FORCE_FAIL=1 noteriv-check-host # ép báo lỗi: healthchecks đỏ + email, rồi chạy lại cho xanh
```

Ngưỡng đổi bằng biến `DISK_MAX_PCT`, `MEM_MIN_MB` trong file env.

## Vì sao dùng MemAvailable

Cột `free` của `free -m` tụt xuống khoảng 150MB mỗi lần build image (cache của kernel chiếm RAM) dù máy vẫn dư RAM. `MemAvailable` trong `/proc/meminfo` đã tính phần cache có thể giải phóng nên không báo động giả.

## Giám sát từ bên ngoài (UptimeRobot)

Hai monitor HTTP(s), chu kỳ 5 phút, cảnh báo qua email:

| Tên | URL | Kỳ vọng |
|---|---|---|
| noteriv-web | `https://noteriv.dsc.edu.vn/` | 200 |
| noteriv-api | `https://noteriv.dsc.edu.vn/api/v1/healthz` | 200 (503 khi DB hoặc Redis hỏng) |

`/api/v1/healthz` công khai, chỉ trả `{"ok":true}` hoặc `{"ok":false}` (không lộ phiên bản hay lỗi; lý do ghi trong log của `noteriv-api`).
