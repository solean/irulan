import type { DragEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { isFileDrag } from "../lib/file-import";

type FileDropTargetOptions = {
  enabled?: boolean;
  onDropFiles: (files: File[]) => void;
};

export function useFileDropTarget({ enabled = true, onDropFiles }: FileDropTargetOptions) {
  const dragDepthRef = useRef(0);
  const [isActive, setIsActive] = useState(false);

  const reset = useCallback(() => {
    dragDepthRef.current = 0;
    setIsActive(false);
  }, []);

  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!enabled || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsActive(true);
    },
    [enabled],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!enabled || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!isActive) setIsActive(true);
    },
    [enabled, isActive],
  );

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!enabled || !isFileDrag(event.dataTransfer)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsActive(false);
    },
    [enabled],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!enabled || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      reset();
      onDropFiles(Array.from(event.dataTransfer.files));
    },
    [enabled, onDropFiles, reset],
  );

  return { isActive, onDragEnter, onDragLeave, onDragOver, onDrop, reset };
}
