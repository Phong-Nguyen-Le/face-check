import { useActionSheet } from "@expo/react-native-action-sheet";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Rect, Svg, Text as SvgText } from "react-native-svg";

import ExpoFaceRecognitionModule from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionModule";

type RecognizeResult = {
  name: string;
  confidence: number;
  found: boolean;
};

type FaceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: RecognizeResult; face: FaceRect | null }
  | { status: "error"; message: string };

export default function IdentifyScreen() {
  const { showActionSheetWithOptions } = useActionSheet();
  const [image, setImage] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [state, setState] = useState<State>({ status: "idle" });

  const pickAndIdentify = () => {
    const options = ["Take Photo", "Choose from Library", "Cancel"];
    showActionSheetWithOptions(
      { options, cancelButtonIndex: 2, title: "Select Image" },
      async (selectedIndex) => {
        let result: ImagePicker.ImagePickerResult | null = null;
        if (selectedIndex === 0) {
          result = await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.9,
          });
        } else if (selectedIndex === 1) {
          result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.9,
          });
        }
        if (!result || result.canceled) return;

        const asset = result.assets[0];
        setImage(asset.uri);
        setImageSize({ width: asset.width, height: asset.height });
        await identify(asset.uri);
      }
    );
  };

  const identify = async (uri: string) => {
    setState({ status: "loading" });
    try {
      const res = await ExpoFaceRecognitionModule.recognizeFaceAsync(uri);
      // Also run detectFacesAsync to get bounding box for display
      const detection = await ExpoFaceRecognitionModule.detectFacesAsync(uri);
      const face = detection.faces[0] ?? null;
      setState({ status: "done", result: res, face });
    } catch (e: any) {
      setState({
        status: "error",
        message: e?.message ?? "Recognition failed.",
      });
    }
  };

  // Convert face pixel coords to display coords within the image view
  const toDisplayBox = (
    face: FaceRect,
    imgW: number,
    imgH: number,
    dispW: number,
    dispH: number
  ) => {
    // Image is displayed with resizeMode "contain" inside a square view
    const scale = Math.min(dispW / imgW, dispH / imgH);
    const offsetX = (dispW - imgW * scale) / 2;
    const offsetY = (dispH - imgH * scale) / 2;
    return {
      x: face.x * scale + offsetX,
      y: face.y * scale + offsetY,
      w: face.width * scale,
      h: face.height * scale,
    };
  };

  const IMG_VIEW = 320;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Identify Face</Text>

      {/* Image area */}
      <Pressable style={styles.imageWrap} onPress={pickAndIdentify}>
        {image ? (
          <>
            <Image
              source={{ uri: image }}
              style={styles.image}
              contentFit="contain"
            />
            {/* Face bounding box overlay */}
            {state.status === "done" && state.face && (() => {
              const b = toDisplayBox(
                state.face,
                imageSize.width,
                imageSize.height,
                IMG_VIEW,
                IMG_VIEW
              );
              const color = state.result.found ? "#4ade80" : "#ff3b30";
              return (
                <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Rect
                    x={b.x} y={b.y}
                    width={b.w} height={b.h}
                    stroke={color} strokeWidth={2}
                    fill="none" rx={4}
                  />
                  {state.result.found && (
                    <SvgText
                      x={b.x + b.w / 2}
                      y={b.y - 8}
                      textAnchor="middle"
                      fill={color}
                      fontSize={13}
                      fontWeight="bold"
                    >
                      {state.result.name}
                    </SvgText>
                  )}
                </Svg>
              );
            })()}
          </>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>🔍</Text>
            <Text style={styles.placeholderText}>Tap to upload image</Text>
          </View>
        )}

        {state.status === "loading" && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.loadingText}>Identifying…</Text>
          </View>
        )}
      </Pressable>

      {/* Result card */}
      {state.status === "done" && (
        <View style={[styles.card, !state.result.found && styles.cardUnknown]}>
          {state.result.found ? (
            <>
              <Text style={styles.cardLabel}>Identified as</Text>
              <Text style={styles.cardName}>{state.result.name}</Text>
              <View style={styles.confidenceRow}>
                <View style={styles.confidenceBar}>
                  <View
                    style={[
                      styles.confidenceFill,
                      { width: `${Math.round(state.result.confidence * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.confidenceText}>
                  {Math.round(state.result.confidence * 100)}%
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.cardUnknownIcon}>?</Text>
              <Text style={styles.cardUnknownText}>No match found</Text>
              <Text style={styles.cardUnknownSub}>
                Enroll this person in the Home tab first.
              </Text>
            </>
          )}
        </View>
      )}

      {state.status === "error" && (
        <View style={[styles.card, styles.cardError]}>
          <Text style={styles.cardErrorText}>{state.message}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable style={styles.btn} onPress={pickAndIdentify}>
          <Text style={styles.btnText}>
            {image ? "Try Another" : "Upload Image"}
          </Text>
        </Pressable>
        {state.status === "done" && image && (
          <Pressable
            style={styles.btnGhost}
            onPress={() => identify(image)}
          >
            <Text style={styles.btnGhostText}>Retry</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingHorizontal: 24,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  imageWrap: {
    width: 320,
    height: 320,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#222",
  },
  image: { width: "100%", height: "100%" },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  placeholderIcon: { fontSize: 48 },
  placeholderText: { color: "#555", fontSize: 15, fontWeight: "500" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { color: "#fff", fontSize: 15, fontWeight: "600" },

  // Result card
  card: {
    width: "100%",
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#4ade80",
    gap: 6,
    alignItems: "center",
  },
  cardUnknown: { borderColor: "#333" },
  cardError: { borderColor: "#ff6b6b" },
  cardLabel: { color: "#888", fontSize: 12, letterSpacing: 0.6 },
  cardName: { color: "#fff", fontSize: 26, fontWeight: "800" },
  confidenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
    width: "100%",
  },
  confidenceBar: {
    flex: 1,
    height: 4,
    backgroundColor: "#222",
    borderRadius: 2,
    overflow: "hidden",
  },
  confidenceFill: {
    height: "100%",
    backgroundColor: "#4ade80",
    borderRadius: 2,
  },
  confidenceText: { color: "#4ade80", fontSize: 13, fontWeight: "700" },
  cardUnknownIcon: {
    fontSize: 36,
    color: "#555",
    fontWeight: "800",
  },
  cardUnknownText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  cardUnknownSub: { color: "#555", fontSize: 13, textAlign: "center" },
  cardErrorText: { color: "#ff6b6b", fontSize: 14, textAlign: "center" },

  // Actions
  actions: { flexDirection: "row", gap: 12 },
  btn: {
    paddingHorizontal: 28,
    paddingVertical: 13,
    backgroundColor: "#fff",
    borderRadius: 50,
  },
  btnText: { color: "#000", fontWeight: "700", fontSize: 15 },
  btnGhost: {
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: "#444",
  },
  btnGhostText: { color: "#888", fontWeight: "600", fontSize: 15 },
});
