#!/usr/bin/env python3
"""Build and sign the "Save to Someday" iOS Shortcut.

  python3 scripts/build-shortcut.py https://your-host.example CAPTURE_TOKEN [out.shortcut]

Produces a signed .shortcut you can AirDrop to your iPhone (or open on the Mac).

Share Sheet behavior:
  • Every URL in the share → one POST /api/capture each
  • Every image (Photos multi-select, screenshots) → convert to JPEG → one POST each
  • Text-only share (no URLs, no images) → one note POST
  • Notification "Saved ✨"

One-request-per-item is required. The previous shortcut Base64-encoded all images into a
single JSON body; ten camera-roll photos exceeded the body limit, OOMed the 1 GB Fly VM,
and crashed Next with repeated `ReadableStream is already closed` uncaughtExceptions.

Signing uses the macOS `shortcuts` CLI (macOS 12+) and needs the Mac signed into iCloud.
"""
import plistlib, subprocess, sys, uuid, os, tempfile

def text(s):
    return {"Value": {"string": s, "attachmentsByRange": {}}, "WFSerializationType": "WFTextTokenString"}

def var_text(name, output_uuid):
    return {"Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {"Type": "ActionOutput", "OutputName": name, "OutputUUID": output_uuid}}},
            "WFSerializationType": "WFTextTokenString"}

def var_attach(name, output_uuid):
    return {"Value": {"Type": "ActionOutput", "OutputName": name, "OutputUUID": output_uuid}, "WFSerializationType": "WFTextTokenAttachment"}

def named_attach(var_name):
    return {"Value": {"Type": "Variable", "VariableName": var_name}, "WFSerializationType": "WFTextTokenAttachment"}

def named_text(var_name):
    return {"Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {"Type": "Variable", "VariableName": var_name}}},
            "WFSerializationType": "WFTextTokenString"}

def stored_attach(var_name):
    """Named shortcut variable set via Set Variable."""
    return {"Value": {"Type": "Variable", "VariableName": var_name}, "WFSerializationType": "WFTextTokenAttachment"}

def ext_input_attach():
    return {"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"}

def ext_input_text():
    return {"Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {"Type": "ExtensionInput"}}}, "WFSerializationType": "WFTextTokenString"}

def form_item(key, value, item_type=0):
    return {"WFItemType": item_type, "WFKey": text(key), "WFValue": value}

def headers(token):
    return {"Value": {"WFDictionaryFieldValueItems": [form_item("Authorization", text(f"Bearer {token}"))]},
            "WFSerializationType": "WFDictionaryFieldValue"}

def post_json(host, token, fields, uuid_out, name="Response"):
    return {"WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "WFURL": text(f"{host}/api/capture"),
                "WFHTTPMethod": "POST",
                "ShowHeaders": True,
                "WFHTTPHeaders": headers(token),
                "WFHTTPBodyType": "JSON",
                "WFJSONValues": {"Value": {"WFDictionaryFieldValueItems": fields}, "WFSerializationType": "WFDictionaryFieldValue"},
                "UUID": uuid_out, "CustomOutputName": name}}

def set_var(name, value_attach):
    return {"WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
            "WFWorkflowActionParameters": {"WFVariableName": name, "WFInput": value_attach}}

def get_var(name, out_uuid, out_name):
    return {"WFWorkflowActionIdentifier": "is.workflow.actions.getvariable",
            "WFWorkflowActionParameters": {
                "WFVariable": stored_attach(name),
                "UUID": out_uuid, "CustomOutputName": out_name}}

def count_items(out_uuid, out_name):
    # Count uses the previous action's output as its input (no WFInput param).
    return {"WFWorkflowActionIdentifier": "is.workflow.actions.count",
            "WFWorkflowActionParameters": {"WFCountType": "Items", "UUID": out_uuid, "CustomOutputName": out_name}}

def if_number_equals(group, output_name, output_uuid, number, mode=0):
    """WFCondition 0 = Equals. WFInput must be Type=Variable wrapping the value (viticci CONTROL_FLOW)."""
    return {"WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": group,
                "WFControlFlowMode": mode,
                "WFCondition": 0,
                "WFNumberValue": number,
                "WFInput": {"Type": "Variable", "Variable": {
                    "Value": {"Type": "ActionOutput", "OutputName": output_name, "OutputUUID": output_uuid},
                    "WFSerializationType": "WFTextTokenAttachment"}}}}

def endif(group):
    return {"WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {"GroupingIdentifier": group, "WFControlFlowMode": 2}}

def build(host, token):
    host = host.rstrip("/")
    urls_uuid = str(uuid.uuid4()).upper()
    imgs_uuid = str(uuid.uuid4()).upper()
    get_urls_uuid = str(uuid.uuid4()).upper()
    get_imgs_uuid = str(uuid.uuid4()).upper()
    url_count_uuid = str(uuid.uuid4()).upper()
    img_count_uuid = str(uuid.uuid4()).upper()
    url_group = str(uuid.uuid4()).upper()
    url_repeat_start = str(uuid.uuid4()).upper()
    url_post = str(uuid.uuid4()).upper()
    img_group = str(uuid.uuid4()).upper()
    img_repeat_start = str(uuid.uuid4()).upper()
    jpg_uuid = str(uuid.uuid4()).upper()
    b64_uuid = str(uuid.uuid4()).upper()
    img_post = str(uuid.uuid4()).upper()
    if_img = str(uuid.uuid4()).upper()
    if_url = str(uuid.uuid4()).upper()
    text_post = str(uuid.uuid4()).upper()

    actions = [
        # Detect every link and every image in the share.
        {"WFWorkflowActionIdentifier": "is.workflow.actions.detect.link",
         "WFWorkflowActionParameters": {"WFInput": ext_input_attach(), "UUID": urls_uuid, "CustomOutputName": "URLs"}},
        set_var("URLs", var_attach("URLs", urls_uuid)),
        {"WFWorkflowActionIdentifier": "is.workflow.actions.detect.images",
         "WFWorkflowActionParameters": {"WFInput": ext_input_attach(), "UUID": imgs_uuid, "CustomOutputName": "Images"}},
        set_var("Images", var_attach("Images", imgs_uuid)),

        # Counts for the text-only fallback (Count reads previous action output).
        get_var("URLs", get_urls_uuid, "URLsAgain"),
        count_items(url_count_uuid, "URLCount"),
        get_var("Images", get_imgs_uuid, "ImagesAgain"),
        count_items(img_count_uuid, "ImageCount"),

        # One POST per URL.
        {"WFWorkflowActionIdentifier": "is.workflow.actions.repeat.each",
         "WFWorkflowActionParameters": {"GroupingIdentifier": url_group, "WFControlFlowMode": 0,
                                       "WFInput": stored_attach("URLs"), "UUID": url_repeat_start}},
        post_json(host, token, [
            form_item("url", named_text("Repeat Item")),
            form_item("channel", text("shortcut")),
        ], url_post, "URLResponse"),
        {"WFWorkflowActionIdentifier": "is.workflow.actions.repeat.each",
         "WFWorkflowActionParameters": {"GroupingIdentifier": url_group, "WFControlFlowMode": 2}},

        # One POST per image: JPEG-compress, then base64. Never batch into one body.
        {"WFWorkflowActionIdentifier": "is.workflow.actions.repeat.each",
         "WFWorkflowActionParameters": {"GroupingIdentifier": img_group, "WFControlFlowMode": 0,
                                       "WFInput": stored_attach("Images"), "UUID": img_repeat_start}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.image.convert",
         "WFWorkflowActionParameters": {
             "WFInput": named_attach("Repeat Item"),
             "WFImageFormat": "JPEG",
             "WFImageCompressionQuality": 0.7,
             "WFImagePreserveMetadata": False,
             "UUID": jpg_uuid, "CustomOutputName": "JPEG"}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.base64encode",
         "WFWorkflowActionParameters": {
             "WFInput": var_attach("JPEG", jpg_uuid),
             "WFEncodeMode": "Encode", "WFBase64LineBreakMode": "None",
             "UUID": b64_uuid, "CustomOutputName": "ImageBase64"}},
        post_json(host, token, [
            form_item("image_base64", var_text("ImageBase64", b64_uuid)),
            form_item("filename", text("shared.jpg")),
            form_item("channel", text("shortcut")),
        ], img_post, "ImageResponse"),
        {"WFWorkflowActionIdentifier": "is.workflow.actions.repeat.each",
         "WFWorkflowActionParameters": {"GroupingIdentifier": img_group, "WFControlFlowMode": 2}},

        # Text-only: ImageCount == 0 and URLCount == 0.
        if_number_equals(if_img, "ImageCount", img_count_uuid, 0, 0),
        if_number_equals(if_url, "URLCount", url_count_uuid, 0, 0),
        post_json(host, token, [
            form_item("text", ext_input_text()),
            form_item("channel", text("shortcut")),
        ], text_post, "TextResponse"),
        endif(if_url),
        endif(if_img),

        {"WFWorkflowActionIdentifier": "is.workflow.actions.notification",
         "WFWorkflowActionParameters": {
             "WFNotificationActionTitle": "Someday",
             "WFNotificationActionBody": text("Saved ✨"),
             "WFNotificationActionSound": False}},
    ]
    return {
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowClientVersion": "2605.0.5",
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [
            "WFURLContentItem", "WFSafariWebPageContentItem", "WFArticleContentItem",
            "WFImageContentItem", "WFStringContentItem", "WFRichTextContentItem",
            "WFGenericFileContentItem", "WFPhotoMediaContentItem",
        ],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowNoInputBehavior": {
            "Name": "WFWorkflowNoInputBehaviorAskForInput",
            "Parameters": {"ItemClass": "WFURLContentItem"},
        },
        "WFQuickActionSurfaces": [],
        "WFWorkflowActions": actions,
    }

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    host, token = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else "Save to Someday.shortcut"
    workflow = build(host, token)
    with tempfile.TemporaryDirectory() as td:
        unsigned = os.path.join(td, "unsigned.shortcut")
        with open(unsigned, "wb") as f:
            plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)
        inspect = os.path.splitext(out)[0] + ".unsigned.plist"
        with open(inspect, "wb") as f:
            plistlib.dump(workflow, f, fmt=plistlib.FMT_XML)
        print(f"wrote unsigned workflow to {inspect}")
        try:
            r = subprocess.run(
                ["shortcuts", "sign", "--mode", "anyone", "--input", unsigned, "--output", out],
                capture_output=True, text=True,
            )
        except FileNotFoundError:
            print("Signing needs a Mac signed into iCloud (System Settings > Apple Account).")
            print(f"On that Mac run: python3 scripts/build-shortcut.py {host} <CAPTURE_TOKEN>")
            print("(unsigned plist ok; re-run on a Mac to produce the AirDrop-able .shortcut)")
            sys.exit(0)
        if r.returncode != 0:
            msg = (r.stderr.strip() or r.stdout.strip())
            if "signed into iCloud" in msg or r.returncode == 127:
                print("Signing needs a Mac signed into iCloud (System Settings > Apple Account).")
                print(f"On that Mac run: python3 scripts/build-shortcut.py {host} <CAPTURE_TOKEN>")
                print("(unsigned plist ok; re-run on a Mac to produce the AirDrop-able .shortcut)")
                sys.exit(0)
            print("signing failed:", (msg or "unknown")[-500:])
            sys.exit(r.returncode or 1)
    print(f"wrote {out}  (host {host}). AirDrop it to your iPhone, or double-click on the Mac to add it.")

if __name__ == "__main__":
    main()
