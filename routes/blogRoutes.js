const express = require("express");
const multer = require("multer");
const Blog = require("../models/Blog");
const he = require("he");
const router = express.Router();

// Set up Multer for image upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// POST: Create blog
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { slug, metaTitle, metaDesc, author, title, content } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";

    // ✅ Decode HTML entities
    const decodedContent = he.decode(content);

    const blog = new Blog({
      slug,
      metaTitle,
      metaDesc,
      author,
      title,
      content: decodedContent, // ⬅️ use decoded content
      imageUrl,
    });

    await blog.save();

    res.status(201).json({ message: "Blog created", blog });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: All blogs
router.get("/", async (req, res) => {
  const blogs = await Blog.find().sort({ createdAt: -1 });
  res.json(blogs);
});

// GET: Single blog by slug
router.get("/:slug", async (req, res) => {
  const blog = await Blog.findOne({ slug: req.params.slug });
  if (blog) {
    res.json(blog);
  } else {
    res.status(404).json({ message: "Blog not found" });
  }
});

// DELETE: Delete blog by slug
router.delete("/:slug", async (req, res) => {
  try {
    const deleted = await Blog.findOneAndDelete({ slug: req.params.slug });
    if (!deleted) {
      return res.status(404).json({ message: "Blog not found" });
    }
    res.json({ message: "Blog deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
