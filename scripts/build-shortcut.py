#!/usr/bin/env python3
"""Build and sign the "Save to Someday" iOS Shortcut.

  python3 scripts/build-shortcut.py https://your-host.example CAPTURE_TOKEN [out.shortcut]

Produces a signed .shortcut you can AirDrop to your iPhone (or open on the Mac). The shortcut appears in the
Share Sheet for links, web pages, images and text, POSTs them to /api/capture as a multipart form, and shows a
notification with the result. Signing uses the macOS `shortcuts` CLI (macOS 12+) and needs the Mac to be signed into iCloud; no developer account needed.
"""
import plistlib, subprocess, sys, uuid, os, tempfile

def text(s):  # plain text value
    return {"Value": {"string": s, "attachmentsByRange": {}}, "WFSerializationType": "WFTextTokenString"}

def var_text(name, output_uuid):  # a magic variable interpolated into a text field
    return {"Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {"Type": "ActionOutput", "OutputName": name, "OutputUUID": output_uuid}}},
            "WFSerializationType": "WFTextTokenString"}

def var_attach(name, output_uuid):  # a magic variable passed as-is (file)
    return {"Value": {"Type": "ActionOutput", "OutputName": name, "OutputUUID": output_uuid}, "WFSerializationType": "WFTextTokenAttachment"}

def ext_input_attach():
    return {"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"}

def ext_input_text():
    return {"Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {"Type": "ExtensionInput"}}}, "WFSerializationType": "WFTextTokenString"}

def form_item(key, value, item_type=0):
    return {"WFItemType": item_type, "WFKey": text(key), "WFValue": value}

def build(host, token):
    host = host.rstrip("/")
    urls_uuid, imgs_uuid, b64_uuid, resp_uuid = (str(uuid.uuid4()).upper() for _ in range(4))
    actions = [
        # 1. Pull any links out of whatever was shared (URL, web page, text). Empty for images.
        {"WFWorkflowActionIdentifier": "is.workflow.actions.detect.link",
         "WFWorkflowActionParameters": {"WFInput": ext_input_attach(), "UUID": urls_uuid, "CustomOutputName": "URLs"}},
        # 2. Pull any images out (screenshots, photos). Empty for links.
        {"WFWorkflowActionIdentifier": "is.workflow.actions.detect.images",
         "WFWorkflowActionParameters": {"WFInput": ext_input_attach(), "UUID": imgs_uuid, "CustomOutputName": "Images"}},
        # 3. Base64 the image (empty string when there is none) so everything travels as one JSON body.
        {"WFWorkflowActionIdentifier": "is.workflow.actions.base64encode",
         "WFWorkflowActionParameters": {"WFInput": var_attach("Images", imgs_uuid), "WFEncodeMode": "Encode", "WFBase64LineBreakMode": "None", "UUID": b64_uuid, "CustomOutputName": "ImageBase64"}},
        # 4. POST as JSON. Empty fields are ignored server-side.
        {"WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
         "WFWorkflowActionParameters": {
             "WFURL": text(f"{host}/api/capture"),
             "WFHTTPMethod": "POST",
             "ShowHeaders": True,
             "WFHTTPHeaders": {"Value": {"WFDictionaryFieldValueItems": [form_item("Authorization", text(f"Bearer {token}"))]}, "WFSerializationType": "WFDictionaryFieldValue"},
             "WFHTTPBodyType": "JSON",
             "WFJSONValues": {"Value": {"WFDictionaryFieldValueItems": [
                 form_item("url", var_text("URLs", urls_uuid)),
                 form_item("text", ext_input_text()),
                 form_item("image_base64", var_text("ImageBase64", b64_uuid)),
                 form_item("filename", text("shared.jpg")),
                 form_item("channel", text("shortcut")),
             ]}, "WFSerializationType": "WFDictionaryFieldValue"},
             "UUID": resp_uuid, "CustomOutputName": "Response"}},
        # 5. Tell the user.
        {"WFWorkflowActionIdentifier": "is.workflow.actions.notification",
         "WFWorkflowActionParameters": {"WFNotificationActionTitle": "Someday", "WFNotificationActionBody": text("Saved ✨"), "WFNotificationActionSound": False}},
    ]
    return {
        "WFWorkflowMinimumClientVersion": 900, "WFWorkflowMinimumClientVersionString": "900", "WFWorkflowClientVersion": "2605.0.5",
        "WFWorkflowHasShortcutInputVariables": True, "WFWorkflowHasOutputFallback": False,
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": ["WFURLContentItem", "WFSafariWebPageContentItem", "WFArticleContentItem", "WFImageContentItem", "WFStringContentItem", "WFRichTextContentItem"],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowNoInputBehavior": {"Name": "WFWorkflowNoInputBehaviorAskForInput", "Parameters": {"ItemClass": "WFURLContentItem"}},
        "WFQuickActionSurfaces": [],
        "WFWorkflowActions": actions,
    }

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    host, token = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else "Save to Someday.shortcut"
    with tempfile.TemporaryDirectory() as td:
        unsigned = os.path.join(td, "unsigned.shortcut")
        with open(unsigned, "wb") as f:
            plistlib.dump(build(host, token), f, fmt=plistlib.FMT_BINARY)
        r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", unsigned, "--output", out], capture_output=True, text=True)
        if r.returncode != 0:
            msg = (r.stderr.strip() or r.stdout.strip())
            if "signed into iCloud" in msg:
                print("Signing needs a Mac that is signed into iCloud (System Settings > Apple Account). Run this script there; the shortcut file itself is fine.")
            else:
                print("signing failed:", msg[-500:])
            sys.exit(r.returncode)
    print(f"wrote {out}  (host {host}). AirDrop it to your iPhone, or double-click on the Mac to add it.")

if __name__ == "__main__":
    main()
