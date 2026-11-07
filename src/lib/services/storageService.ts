import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import { v4 as uuidv4 } from "uuid";

export const storageService = {
  /** `onProgress` recebe de 0 a 100, pelos bytes que já chegaram ao Storage. */
  uploadFile: async (
    file: File,
    path: string,
    onProgress?: (percent: number) => void,
  ) => {
    const fileId = uuidv4();
    const storageRef = ref(storage, `${path}/${fileId}-${file.name}`);

    const task = uploadBytesResumable(storageRef, file);
    if (onProgress)
      task.on("state_changed", (s) =>
        onProgress(
          s.totalBytes ? (s.bytesTransferred / s.totalBytes) * 100 : 0,
        ),
      );
    await task;
    const url = await getDownloadURL(storageRef);

    return {
      id: fileId,
      url,
      name: file.name,
      type: file.type,
      path: storageRef.fullPath,
    };
  },

  deleteFile: async (path: string) => {
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
  },
};
