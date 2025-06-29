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
// In your backend route for fetching one blog (add suggested)
router.get("/:slug", async (req, res) => {
  const blog = await Blog.findOne({ slug: req.params.slug });
  if (!blog) return res.status(404).json({ message: "Not found" });

  const suggested = await Blog.find({ slug: { $ne: req.params.slug } })
    .sort({ createdAt: -1 })
    .limit(3); // or 5

  res.json({ blog, suggested });
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

// update route of blog
router.put("/:slug", upload.single("image"), async (req, res) => {
  try {
    const { slug } = req.params;
    const { metaTitle, metaDesc, author, title, content } = req.body;

    const blog = await Blog.findOne({ slug });
    if (!blog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    // Update fields
    blog.metaTitle = metaTitle || blog.metaTitle;
    blog.metaDesc = metaDesc || blog.metaDesc;
    blog.author = author || blog.author;
    blog.title = title || blog.title;
    blog.content = content ? require("he").decode(content) : blog.content;

    // If image is updated
    if (req.file) {
      blog.imageUrl = `/uploads/${req.file.filename}`;
    }

    await blog.save();

    res.json({ message: "Blog updated", blog });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
