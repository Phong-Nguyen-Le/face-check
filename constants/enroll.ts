import { Slot } from "@/types/enroll";

export const SLOT_KEYS: Slot[] = ["front", "left", "right"];
export const SLOT_CONFIG = [
  { key: "front" as Slot, label: "Front" },
  { key: "left" as Slot, label: "Left" },
  { key: "right" as Slot, label: "Right" },
];

export const ENROLL_STEPS = [
  {
    yawMin: -0.15,
    yawMax: 0.15,
    label: "Nhìn thẳng",
    sub: "Nhìn trực tiếp vào camera",
    optional: false,
  },
  {
    yawMin: 0.2,
    yawMax: 0.8,
    label: "Quay nhẹ sang trái",
    sub: "Xoay đầu nhẹ sang bên trái",
    optional: true,
  },
  {
    yawMin: -0.8,
    yawMax: -0.2,
    label: "Quay nhẹ sang phải",
    sub: "Xoay đầu nhẹ sang bên phải",
    optional: true,
  },
];

export const HOLD_MS = 1500;
