"use client";

import React, { useRef, useEffect } from "react";
import * as jdenticon from "jdenticon";

type IdenticonProps = {
  value: string;
  size?: number;
  className?: string;
};

export default function Identicon({ value, size = 36, className = "" }: IdenticonProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = jdenticon.toSvg(value, size);
    }
  }, [value, size]);

  return (
    <span
      ref={ref}
      className={`inline-block align-middle ${className}`}
      style={{ width: size, height: size }}
      aria-label="Identicon"
      role="img"
      dangerouslySetInnerHTML={{ __html: jdenticon.toSvg(value, size) }}
    />
  );
}
