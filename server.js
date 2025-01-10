const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Ensure the uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

// Message Schema
const messageSchema = new mongoose.Schema({
  sender: String,
  content: String,
  fileUrl: String,
  fileType: String,
  timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", messageSchema);

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  socketId: String,
  joinedAt: { type: Date, default: Date.now },
});
const User = mongoose.model("User", userSchema);

// API endpoint to get chat history
app.get("/messages", async (req, res) => {
  try {
    const messages = await Message.find();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API endpoint to get online users
app.get("/online-users", async (req, res) => {
  try {
    const onlineUsers = await User.find({ socketId: { $exists: true } }).select("username -_id");
    res.json(onlineUsers.map((user) => user.username));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// File upload endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl, fileType: req.file.mimetype });
});

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Server and WebSocket setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  console.log("A user connected");

  // Handle user registration
  socket.on("registerUser", async (data) => {
    try {
      let user = await User.findOneAndUpdate(
        { username: data.username },
        { socketId: socket.id },
        { new: true, upsert: true }
      );
      console.log(`${data.username} is connected`);

      const onlineUsers = await User.find({ socketId: { $exists: true } }).select("username -_id");
      io.emit("userConnected", onlineUsers.map((user) => user.username));
    } catch (err) {
      console.error(err);
    }
  });

  // Handle sending messages
  socket.on("sendMessage", async (data) => {
    try {
      const sender = await User.findOne({ socketId: socket.id });

      if (!sender) {
        return socket.emit("error", { message: "Unauthorized user" });
      }

      const newMessage = new Message({
        sender: sender.username,
        content: data.content || "",
        fileUrl: data.fileUrl || null,
        fileType: data.fileType || null,
      });
      await newMessage.save();
      io.emit("receiveMessage", newMessage);
    } catch (err) {
      console.error(err);
    }
  });

  // Handle clearing chat
  socket.on("clearChat", async () => {
    await Message.deleteMany();
    io.emit("receiveMessage", []);
  });

  // Handle disconnection
  socket.on("disconnect", async () => {
    try {
      let user = await User.findOneAndUpdate(
        { socketId: socket.id },
        { $unset: { socketId: 1 } }
      );
      console.log(`${user?.username || "A user"} disconnected`);

      const onlineUsers = await User.find({ socketId: { $exists: true } }).select("username -_id");
      io.emit("userDisconnected", onlineUsers.map((user) => user.username));
    } catch (err) {
      console.error(err);
    }
  });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
