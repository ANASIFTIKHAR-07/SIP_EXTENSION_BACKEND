import { CctvProduct } from "../models/cctvproduct.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const SEED_CATALOG = [
  {
    brand: "Hikvision",
    model: "DS-2CD2143G2-I",
    category: "dome",
    resolution: "4MP",
    features: ["AcuSense", "IP67", "IK10 Vandal Resistant", "IR 30m"],
    priceMin: 12000,
    priceMax: 15000,
    description: "Ideal for indoor or low-ceiling outdoor spaces. Excellent vandal resistance.",
  },
  {
    brand: "Hikvision",
    model: "DS-2CD2T87G2-L",
    category: "bullet",
    resolution: "8MP / 4K",
    features: ["ColorVu", "24/7 Color", "IP67", "Warm LED 60m"],
    priceMin: 22000,
    priceMax: 26000,
    description: "Premium bullet camera offering full-color video even in pitch dark. Great for perimeter security.",
  },
  {
    brand: "Hikvision",
    model: "DS-2DE4425IW-DE",
    category: "ptz",
    resolution: "4MP",
    features: ["25x Optical Zoom", "DarkFighter", "IR 100m", "Smart Tracking"],
    priceMin: 65000,
    priceMax: 70000,
    description: "Advanced PTZ camera for large areas like parking lots or warehouses.",
  },
  {
    brand: "Hikvision",
    model: "DS-7208HQHI-K1",
    category: "dvr",
    resolution: "Up to 4MP",
    features: ["8 Channel", "H.265 Pro+", "Supports analog & IP"],
    priceMin: 14000,
    priceMax: 18000,
    description: "Reliable 8-channel DVR for upgrading existing analog setups.",
  },
  {
    brand: "Dahua",
    model: "IPC-HFW2431S-S-S2",
    category: "bullet",
    resolution: "4MP",
    features: ["Starlight", "IP67", "IR 30m"],
    priceMin: 11000,
    priceMax: 14000,
    description: "Cost-effective 4MP bullet camera with excellent low-light performance.",
  },
  {
    brand: "Dahua",
    model: "IPC-HDW3841EM-AS",
    category: "turret",
    resolution: "8MP / 4K",
    features: ["WizSense", "SMD Plus", "Built-in Mic", "IP67"],
    priceMin: 19000,
    priceMax: 23000,
    description: "AI-powered turret camera that filters out false alarms like leaves and pets.",
  },
  {
    brand: "Dahua",
    model: "NVR4108-8P-4KS2/L",
    category: "nvr",
    resolution: "Up to 8MP/4K",
    features: ["8 Channel", "8 PoE Ports", "Space-saving"],
    priceMin: 20000,
    priceMax: 24000,
    description: "Easy plug-and-play NVR with built-in PoE, perfect for home or small office IP systems.",
  },
  {
    brand: "CP Plus",
    model: "CP-UNC-TA21L3-V3",
    category: "bullet",
    resolution: "2MP",
    features: ["InstaStream", "IR 30m", "IP67"],
    priceMin: 6000,
    priceMax: 8000,
    description: "Budget-friendly IP camera for basic outdoor monitoring.",
  },
  {
    brand: "CP Plus",
    model: "CP-UNC-DA21L3-V3",
    category: "dome",
    resolution: "2MP",
    features: ["InstaStream", "IR 30m", "IP67"],
    priceMin: 5500,
    priceMax: 7500,
    description: "Budget-friendly 2MP dome camera for simple indoor security.",
  },
  {
    brand: "Uniview (UNV)",
    model: "IPC2124LE-ADF28KM-G",
    category: "bullet",
    resolution: "4MP",
    features: ["ColorHunter", "Built-in Mic", "IP67"],
    priceMin: 12500,
    priceMax: 16000,
    description: "Solid mid-range bullet camera providing 24/7 color and audio.",
  },
  {
    brand: "TP-Link VIGI",
    model: "VIGI C440",
    category: "turret",
    resolution: "4MP",
    features: ["Full-Color", "Smart Detection", "H.265+"],
    priceMin: 9000,
    priceMax: 12000,
    description: "Very affordable 4MP full-color camera with smart app integration.",
  },
  {
    brand: "Hikvision",
    model: "4-Cam 2MP Analog Package",
    category: "package",
    resolution: "2MP",
    features: ["4x 2MP Cameras", "4-Ch DVR", "500GB HDD", "Cable & Supply"],
    priceMin: 22000,
    priceMax: 26000,
    description: "Complete starter package for basic home or small shop security.",
  },
  {
    brand: "Dahua",
    model: "8-Cam 4MP IP Package",
    category: "package",
    resolution: "4MP",
    features: ["8x 4MP IP Cameras", "8-Ch PoE NVR", "2TB HDD", "Cat6 Cable Roll"],
    priceMin: 90000,
    priceMax: 110000,
    description: "Professional grade, high-resolution IP package for commercial properties.",
  }
];

// @desc    Sync/Seed the product catalog with curated data
// @route   POST /api/v1/cctv-products/sync
const syncCatalog = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // For this implementation, we will wipe the user's existing products and re-seed
  // Alternatively, we could upsert based on brand/model.
  await CctvProduct.deleteMany({ createdBy: userId });

  const productsToInsert = SEED_CATALOG.map((p) => ({
    ...p,
    createdBy: userId,
    isActive: true,
  }));

  const inserted = await CctvProduct.insertMany(productsToInsert);

  return res
    .status(200)
    .json(new ApiResponse(200, { count: inserted.length }, "Catalog synced successfully"));
});

// @desc    Get all CCTV products for the user
// @route   GET /api/v1/cctv-products
const getProducts = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { brand } = req.query;

  const query = { createdBy: userId };
  if (brand) {
    query.brand = brand;
  }

  const products = await CctvProduct.find(query).sort({ brand: 1, category: 1, priceMin: 1 });

  return res.status(200).json(new ApiResponse(200, products, "Products retrieved successfully"));
});

// @desc    Delete a CCTV product
// @route   DELETE /api/v1/cctv-products/:id
const deleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const product = await CctvProduct.findOneAndDelete({ _id: id, createdBy: userId });

  if (!product) {
    throw new ApiError(404, "Product not found or unauthorized");
  }

  return res.status(200).json(new ApiResponse(200, { deleted: id }, "Product deleted successfully"));
});

export { syncCatalog, getProducts, deleteProduct };
