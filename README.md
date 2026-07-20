# Devre Kurucu — Levha VIII

Ortaokul öğrencileri için sürükle-bırakla elektrik devresi kurma aracı. Pil, ampul, anahtar ve
kablolarla oyna; ampuller **gerçek devre fiziğiyle** yanar (arkada tam bir MNA devre çözücü çalışır).
"Etkileşimli Bilim Levhaları" serisinin sekizinci levhası — saf JavaScript.

**Canlı:** https://hakanatas.github.io/devre-kurucu/ · **Ana sayfa:** https://hakanatas.github.io/bilim-levhalari/

## Özellikler
- Pil / ampul / anahtar ekle, sürükleyip yerleştir; terminallere tıklayarak kablo çek.
- **Gerçek fizik:** kapalı devrede ampul yanar; seri bağlamada sönük, paralel bağlamada parlak;
  pil eklemek parlaklığı artırır; ampulsüz doğrudan bağlantı **kısa devre** uyarısı verir.
- Anahtara tıkla aç-kapa; akım kablolarda hareketli noktalarla görünür; ampuller sarı haleyle parlar.
- 5 görev: bir ampul yak, anahtarla kontrol et, iki ampul yak, paralel bağla, seri bağla.
- Dokunmatik ve mobil uyumlu.

## Nasıl çalışır
Devre grafiği union-find ile sadeleştirilir (teller + kapalı anahtarlar düğümleri birleştirir),
kalan pil/ampul ağı **Modified Nodal Analysis** ile çözülür. Ampul akımından parlaklık hesaplanır.

```bash
python3 -m http.server 8325
```
