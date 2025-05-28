const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const mongoose = require("mongoose")
const cors = require("cors")
const dotenv = require("dotenv")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcryptjs")

// Routes
const adminRoutes = require("./routes/admin")

// Models
const Session = require("./models/Session")
const Report = require("./models/Report")
const Admin = require("./models/Admin")

// Load environment variables
dotenv.config()

// Initialize Express app
const app = express()
const server = http.createServer(app)

// Middleware
app.use(cors())

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000, // Increase ping timeout to handle slow connections
})

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/omegle-clone", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err))

// API routes
app.use("/api/admin", adminRoutes)

// Socket.io logic
const waitingUsers = {
  text: [],
  video: [],
}

const activeConnections = new Map()
const userStatus = new Map() // Track user status: 'waiting', 'connected', 'disconnecting'

// Helper function to find a partner for a user
const findPartnerForUser = (socket, chatType = "video") => {
  console.log(`Finding partner for user ${socket.id}. Chat type: ${chatType}`)

  // Set user status to waiting
  userStatus.set(socket.id, "waiting")

  // First, make sure the user isn't already in a connection
  const existingPartnerId = activeConnections.get(socket.id)
  if (existingPartnerId) {
    console.log(`User ${socket.id} already has a partner ${existingPartnerId}, disconnecting first`)
    // Notify the current partner that the user disconnected
    io.to(existingPartnerId).emit("partner-disconnected")

    // Remove the connection
    activeConnections.delete(existingPartnerId)
    activeConnections.delete(socket.id)
  }

  // Remove from any waiting lists first (in case they're already waiting)
  for (const type in waitingUsers) {
    const index = waitingUsers[type].indexOf(socket.id)
    if (index !== -1) {
      waitingUsers[type].splice(index, 1)
    }
  }

  // Ensure the chatType exists in waitingUsers
  if (!waitingUsers[chatType]) {
    waitingUsers[chatType] = []
  }

  // Check if there's someone waiting
  if (waitingUsers[chatType] && waitingUsers[chatType].length > 0) {
    // Find a valid waiting user
    let partnerId = null
    let partnerSocket = null

    // Loop through waiting users to find a valid one
    while (waitingUsers[chatType].length > 0 && !partnerSocket) {
      partnerId = waitingUsers[chatType].shift()
      partnerSocket = io.sockets.sockets.get(partnerId)

      // If partner socket doesn't exist or is already in a connection, skip it
      if (!partnerSocket || activeConnections.has(partnerId)) {
        console.log(`Invalid waiting user ${partnerId}, skipping`)
        partnerId = null
        partnerSocket = null
      }
    }

    if (partnerSocket) {
      console.log(`Matching ${socket.id} with ${partnerId}`)

      // Update user statuses
      userStatus.set(socket.id, "connected")
      userStatus.set(partnerId, "connected")

      // Create a connection between the two users
      activeConnections.set(socket.id, partnerId)
      activeConnections.set(partnerId, socket.id)

      // Generate random country for demo purposes
      const countries = ["USA", "Canada", "India", "UK", "Australia", "Germany", "France", "Japan"]
      const randomCountry = countries[Math.floor(Math.random() * countries.length)]

      // Notify both users that they've been paired
      socket.emit("partner-found", { partnerId, initiator: true, country: randomCountry })
      partnerSocket.emit("partner-found", { partnerId: socket.id, initiator: false, country: randomCountry })

      return true // Successfully matched
    } else {
      console.log(`No valid partners available, adding ${socket.id} to waiting list`)
      // Add user to waiting list
      waitingUsers[chatType].push(socket.id)
      return false // No match found
    }
  } else {
    console.log(`No partners available, adding ${socket.id} to waiting list`)
    // Add user to waiting list
    waitingUsers[chatType].push(socket.id)
    return false // No match found
  }
}

// Helper function to handle user disconnection
const handleUserDisconnection = (socketId) => {
  console.log(`Handling disconnection for user ${socketId}`)

  // Remove from waiting list
  for (const type in waitingUsers) {
    const index = waitingUsers[type].indexOf(socketId)
    if (index !== -1) {
      waitingUsers[type].splice(index, 1)
    }
  }

  // Notify partner if connected
  const partnerId = activeConnections.get(socketId)
  if (partnerId) {
    console.log(`Notifying partner ${partnerId} about disconnection`)

    // Set the partner's status to disconnecting
    userStatus.set(partnerId, "disconnecting")

    // Notify the partner
    io.to(partnerId).emit("partner-disconnected")

    // Remove the connection
    activeConnections.delete(partnerId)
    activeConnections.delete(socketId)

    // Find a new partner for the disconnected user's partner
    const partnerSocket = io.sockets.sockets.get(partnerId)
    if (partnerSocket) {
      console.log(`Finding new partner for ${partnerId}`)
      // Wait a short time to ensure clean disconnection
      setTimeout(() => {
        // Only find a new partner if the user is still disconnecting (hasn't found a partner yet)
        if (userStatus.get(partnerId) === "disconnecting") {
          findPartnerForUser(partnerSocket, "video")
        }
      }, 1000)
    }
  }

  // Clean up user status
  userStatus.delete(socketId)
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id)

  // Set initial user status
  userStatus.set(socket.id, "new")

  // Create a new session record
  const session = new Session({
    socketId: socket.id,
    ipAddress: socket.handshake.headers["x-forwarded-for"] || socket.handshake.address,
    startTime: new Date(),
  })

  session
    .save()
    .then((savedSession) => {
      socket.sessionId = savedSession._id
    })
    .catch((err) => console.error("Error saving session:", err))

  // Find a partner
  socket.on("find-partner", ({ chatType = "video", interests }) => {
    findPartnerForUser(socket, chatType)
  })

  // Handle WebRTC signaling
  socket.on("offer", (offer) => {
    const partnerId = activeConnections.get(socket.id)
    if (partnerId) {
      io.to(partnerId).emit("offer", offer)
    }
  })

  socket.on("answer", (answer) => {
    const partnerId = activeConnections.get(socket.id)
    if (partnerId) {
      io.to(partnerId).emit("answer", answer)
    }
  })

  socket.on("ice-candidate", (candidate) => {
    const partnerId = activeConnections.get(socket.id)
    if (partnerId) {
      io.to(partnerId).emit("ice-candidate", candidate)
    }
  })

  // Handle chat messages
  socket.on("chat-message", (message) => {
    const partnerId = activeConnections.get(socket.id)
    if (partnerId) {
      io.to(partnerId).emit("chat-message", message)
    }
  })

  // Handle "next partner" request
  socket.on("next-partner", () => {
    console.log(`User ${socket.id} requesting next partner`)

    // Handle disconnection from current partner
    const partnerId = activeConnections.get(socket.id)
    if (partnerId) {
      console.log(`Notifying current partner ${partnerId} about disconnection`)

      // Set the partner's status to disconnecting
      userStatus.set(partnerId, "disconnecting")

      // Notify the partner
      io.to(partnerId).emit("partner-disconnected")

      // Remove the connection
      activeConnections.delete(partnerId)
      activeConnections.delete(socket.id)

      // Find a new partner for the disconnected user's partner
      const partnerSocket = io.sockets.sockets.get(partnerId)
      if (partnerSocket) {
        console.log(`Finding new partner for ${partnerId}`)
        // Wait a short time to ensure clean disconnection
        setTimeout(() => {
          // Only find a new partner if the user is still disconnecting (hasn't found a partner yet)
          if (userStatus.get(partnerId) === "disconnecting") {
            findPartnerForUser(partnerSocket, "video")
          }
        }, 1000)
      }
    }

    // Find a new partner for the current user
    findPartnerForUser(socket, "video")
  })

  // Handle abuse reports
  socket.on("report-user", ({ reason }) => {
    const partnerId = activeConnections.get(socket.id)

    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId)

      if (partnerSocket) {
        const report = new Report({
          reporterId: socket.id,
          reporterIp: socket.handshake.headers["x-forwarded-for"] || socket.handshake.address,
          reportedId: partnerId,
          reportedIp: partnerSocket.handshake.headers["x-forwarded-for"] || partnerSocket.handshake.address,
          reason: reason,
        })

        report.save().catch((err) => console.error("Error saving report:", err))
      }
    }
  })

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id)

    // Update session end time
    if (socket.sessionId) {
      Session.findByIdAndUpdate(socket.sessionId, {
        endTime: new Date(),
      }).catch((err) => console.error("Error updating session:", err))
    }

    // Handle user disconnection
    handleUserDisconnection(socket.id)
  })
})

// Periodic cleanup of stale connections
setInterval(() => {
  console.log("Running periodic cleanup")

  // Check for stale connections
  for (const [socketId, partnerId] of activeConnections.entries()) {
    const socket = io.sockets.sockets.get(socketId)
    const partnerSocket = io.sockets.sockets.get(partnerId)

    if (!socket || !partnerSocket) {
      console.log(`Found stale connection: ${socketId} -> ${partnerId}`)

      // Clean up the stale connection
      activeConnections.delete(socketId)
      activeConnections.delete(partnerId)

      // If one socket still exists, find it a new partner
      if (socket && !partnerSocket) {
        console.log(`Socket ${socketId} exists but partner ${partnerId} doesn't, finding new partner`)
        setTimeout(() => findPartnerForUser(socket, "video"), 1000)
      } else if (!socket && partnerSocket) {
        console.log(`Socket ${socketId} doesn't exist but partner ${partnerId} does, finding new partner`)
        setTimeout(() => findPartnerForUser(partnerSocket, "video"), 1000)
      }
    }
  }

  // Clean up waiting lists
  for (const type in waitingUsers) {
    const validWaitingUsers = []
    for (const socketId of waitingUsers[type]) {
      const socket = io.sockets.sockets.get(socketId)
      if (socket && !activeConnections.has(socketId)) {
        validWaitingUsers.push(socketId)
      } else {
        console.log(`Removing invalid waiting user: ${socketId}`)
      }
    }
    waitingUsers[type] = validWaitingUsers
  }

  console.log("Current waiting users:", waitingUsers)
  console.log("Current active connections:", Array.from(activeConnections.entries()))
}, 30000) // Run every 30 seconds

// Create default admin user if none exists
const createDefaultAdmin = async () => {
  try {
    const adminCount = await Admin.countDocuments()

    if (adminCount === 0) {
      const hashedPassword = await bcrypt.hash("admin123", 10)

      const admin = new Admin({
        username: "admin",
        password: hashedPassword,
      })

      await admin.save()
      console.log("Default admin user created")
    }
  } catch (error) {
    console.error("Error creating default admin:", error)
  }
}

createDefaultAdmin()

// Start server
const PORT = process.env.PORT || 5000
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
