const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true },
  metaTitle: String,
  metaDesc: String,
  author: String,
  title: String,
  content: String,
  imageUrl: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Blog", blogSchema);
