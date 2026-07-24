import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { QrCode, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function QrTab({ pet }: { pet: any }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pet?.qrToken || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, pet.qrToken, {
      width: 280,
      margin: 3,
      color: { dark: "#000000", light: "#ffffff" },
    });
    QRCode.toDataURL(pet.qrToken, {
      width: 600,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, [pet?.qrToken]);

  if (!pet?.qrToken) {
    return (
      <div className="max-w-sm mx-auto text-center py-12 text-muted-foreground">
        <QrCode className="h-12 w-12 mx-auto mb-4 opacity-30" />
        <p>QR Code não disponível para este pet.</p>
      </div>
    );
  }

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `qr-${pet.name.toLowerCase().replace(/\s/g, "-")}.png`;
    a.click();
  };

  return (
    <div className="max-w-sm mx-auto">
      <Card>
        <CardContent className="p-8 flex flex-col items-center gap-6">
          <div>
            <h3 className="text-xl font-display font-semibold text-white text-center">{pet.name}</h3>
            <p className="text-sm text-muted-foreground text-center mt-1">QR Code de Identificação</p>
          </div>

          <div className="p-3 rounded-2xl bg-white shadow-[0_0_30px_rgba(139,92,246,0.3)]">
            <canvas ref={canvasRef} className="rounded-lg block" />
          </div>

          <div className="w-full space-y-3">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
              <p className="text-xs text-muted-foreground mb-1">Token de Identificação</p>
              <p className="text-xs font-mono text-primary break-all">{pet.qrToken}</p>
            </div>
            <Button className="w-full" variant="outline" onClick={handleDownload} disabled={!qrDataUrl}>
              <Download className="mr-2 h-4 w-4" /> Baixar QR Code
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Imprima e fixe na coleira do pet. A staff pode escanear para identificação rápida.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
