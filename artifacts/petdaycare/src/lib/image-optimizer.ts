/**
 * Otimiza uma imagem recebida de um <input type="file"> via Canvas.
 * - Redimensiona mantendo a proporção (máx 1280px).
 * - Converte para WebP com 80% de qualidade.
 * Retorna um novo objeto File pronto para upload.
 */
export async function optimizeImage(file: File, maxWidth = 1280, maxHeight = 1280, quality = 0.8): Promise<File> {
  // Ignora se não for imagem
  if (!file.type.startsWith("image/")) {
    return file;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calcula novas dimensões mantendo a proporção
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return resolve(file); // fallback se não suportar canvas
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return resolve(file); // fallback
            }
            // Cria novo File em formato webp
            const optimizedFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".webp"), {
              type: "image/webp",
              lastModified: Date.now(),
            });
            resolve(optimizedFile);
          },
          "image/webp",
          quality
        );
      };
      img.onerror = (error) => {
        console.error("Erro ao carregar imagem para otimização", error);
        resolve(file); // fallback em caso de erro
      };
    };
    reader.onerror = (error) => {
      console.error("Erro ao ler arquivo", error);
      resolve(file);
    };
  });
}
