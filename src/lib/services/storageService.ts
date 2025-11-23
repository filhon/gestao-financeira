import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import { v4 as uuidv4 } from "uuid";

export const storageService = {
    uploadFile: async (file: File, path: string) => {
        const fileId = uuidv4();
        const storageRef = ref(storage, `${path}/${fileId}-${file.name}`);

        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        return {
            id: fileId,
            url,
            name: file.name,
            type: file.type,
            path: storageRef.fullPath
        };
    },

    deleteFile: async (path: string) => {
        const storageRef = ref(storage, path);
        await deleteObject(storageRef);
    }
};
