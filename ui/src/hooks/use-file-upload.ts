import { useCallback, useState } from "react";
import { useRequestAssetUpload, useConfirmAssetUpload } from "@/integrations/api/admin";
import { toast } from "sonner";

export interface UploadedFile {
  id: string;
  url: string;
  name: string;
}

export function useFileUpload(prefix: string = "assets") {
  const requestUpload = useRequestAssetUpload();
  const confirmUpload = useConfirmAssetUpload();
  const [uploading, setUploading] = useState(false);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]): Promise<UploadedFile[]> => {
      const filesToUpload = Array.from(fileList);
      const results: UploadedFile[] = [];

      setUploading(true);
      try {
        for (const file of filesToUpload) {
          try {
            const uploadReq = await requestUpload.mutateAsync({
              filename: file.name,
              contentType: file.type || "image/png",
              prefix,
            });

            const uploadRes = await fetch(uploadReq.presignedUrl, {
              method: "PUT",
              body: file,
              headers: { "Content-Type": file.type || "image/png" },
            });

            if (!uploadRes.ok) {
              throw new Error(`Upload failed with status ${uploadRes.status}`);
            }

            const asset = await confirmUpload.mutateAsync({
              key: uploadReq.key,
              publicUrl: uploadReq.publicUrl,
              assetId: uploadReq.assetId,
              filename: file.name,
              contentType: file.type,
              size: file.size,
            });

            const result: UploadedFile = {
              id: asset.id,
              url: asset.url,
              name: file.name,
            };
            results.push(result);
          } catch (error) {
            toast.error(`Failed to upload ${file.name}`, {
              description: error instanceof Error ? error.message : "Upload failed",
            });
          }
        }
      } finally {
        setUploading(false);
      }

      return results;
    },
    [requestUpload, confirmUpload, prefix],
  );

  const uploadSingle = useCallback(
    async (file: File): Promise<UploadedFile | null> => {
      const results = await uploadFiles([file]);
      return results[0] ?? null;
    },
    [uploadFiles],
  );

  return { uploadFiles, uploadSingle, uploading };
}
