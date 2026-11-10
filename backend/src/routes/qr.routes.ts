import { Router } from 'express';
import QRCode from 'qrcode';

// Public booking-QR image for emails: GET /api/qr/RT-1A2B3C4D.png
//
// Gmail strips `data:` images and doesn't reliably render cid: inline
// attachments, but it always shows a normal https image (fetched through its
// image proxy). This endpoint only ENCODES the code it is given — it never
// looks anything up — so it reveals nothing and can't be used to discover
// bookings. The strict format check keeps it from being a general QR service.
const router = Router();
const CODE_RE = /^RT-[0-9A-F]{8}$/;

router.get('/:file', async (req, res, next) => {
  try {
    const file = String(req.params.file || '');
    const code = file.toUpperCase().replace(/\.PNG$/, '');
    if (!file.toLowerCase().endsWith('.png') || !CODE_RE.test(code)) {
      res.status(404).end();
      return;
    }
    const png = await QRCode.toBuffer(code, { type: 'png', width: 320, margin: 1, errorCorrectionLevel: 'M' });
    res.set({
      'Content-Type': 'image/png',
      // Same code -> same image forever.
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Mail clients / image proxies load it cross-origin.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(png);
  } catch (err) {
    next(err);
  }
});

export default router;
