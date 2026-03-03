import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Sip } from "../models/extension.model.js";
// ✅ Use the shared srf instance, don't create a new one
import { srf } from "../services/drachito.service.js";

const createSipExtension = asyncHandler(async (req, res) => {
  const { domain, extensionUsername, password, extension, pbx, displayName } =
    req.body;

  if (
    [domain, extensionUsername, password, extension].some(
      (field) => field?.trim() === "",
    )
  ) {
    throw new ApiError(400, "Domain, Extension Username, Password and Extension are required.");
  }

  const existedExtension = await Sip.findOne({
    $or: [{ extension }, { extensionUsername }],
    user: req.user._id,
  });

  if (existedExtension) {
    throw new ApiError(409, "Extension or Extension Username already exists.");
  }

  const sipExtension = await Sip.create({
    domain,
    extensionUsername,
    password,
    extension,
    pbx: pbx || null,
    displayName: displayName || null,
    user: req.user._id,
  });

  if (!sipExtension) {
    throw new ApiError(500, "Something went wrong while creating SIP extension.");
  }

  // ✅ Use shared srf instance — already connected via drachito.service.js
  srf.request(
    "sip:q.sgycm.yeastarcloud.com",
    {
      method: "REGISTER",
      headers: {
        Contact: "<sip:208@13.203.20.182:5070>",
        To: "sip:208@q.sgycm.yeastarcloud.com",
        From: "sip:208@q.sgycm.yeastarcloud.com",
      },
      auth: {
        username: "208",
        password: "Smart@0500",
      },
    },
    (err, sreq) => {
      if (err) return console.log("❌ Failed to send REGISTER:", err);
      sreq.on("response", (sres) => {
        console.log(`📩 Status: ${sres.status} ${sres.reason}`);
        if (sres.status === 200) console.log("🚀 REGISTERED SUCCESS!");
      });
    },
  );

  return res.status(201).json(
    new ApiResponse(201, sipExtension, "SIP extension created successfully.")
  );
});

const deleteSipExtension = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const sipExtension = await Sip.findOne({ _id: id, user: req.user._id });

  if (!sipExtension) {
    throw new ApiError(404, "SIP extension not found.");
  }

  await Sip.findByIdAndDelete(id);

  return res.status(200).json(new ApiResponse(200, {}, "SIP extension deleted successfully."));
});

const getAllSipExtensions = asyncHandler(async (req, res) => {
  const sipExtensions = await Sip.find({ user: req.user._id }).select("-password");

  return res.status(200).json(
    new ApiResponse(200, sipExtensions, "SIP extensions fetched successfully.")
  );
});

export { createSipExtension, deleteSipExtension, getAllSipExtensions };