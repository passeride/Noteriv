"use client";

import { useEffect } from "react";
import { initErrorReporting } from "@/lib/error-reporting";

/** Mounted once in the root layout: turns browser error reporting on when the server has it configured. */
export default function ErrorReporting() {
  useEffect(() => {
    void initErrorReporting();
  }, []);
  return null;
}
