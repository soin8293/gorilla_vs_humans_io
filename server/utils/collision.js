/**
 * Checks if a circle and a rectangle are colliding.
 *
 * @param {number} cx - X-coordinate of the circle's center.
 * @param {number} cy - Y-coordinate of the circle's center.
 * @param {number} rad - Radius of the circle.
 * @param {number} rx - X-coordinate of the rectangle's top-left corner.
 * @param {number} ry - Y-coordinate of the rectangle's top-left corner.
 * @param {number} rw - Width of the rectangle.
 * @param {number} rh - Height of the rectangle.
 * @returns {boolean} True if colliding, false otherwise.
 */
function circleRectCollision(cx, cy, rad, rx, ry, rw, rh) {
    // Temporary variables to set edges for testing
    let testX = cx;
    let testY = cy;

    // Which edge is closest?
    if (cx < rx)         testX = rx;      // Test left edge
    else if (cx > rx + rw) testX = rx + rw;   // Test right edge
    if (cy < ry)         testY = ry;      // Test top edge
    else if (cy > ry + rh) testY = ry + rh;   // Test bottom edge

    // Get distance from closest edges
    const distX = cx - testX;
    const distY = cy - testY;
    const distance = Math.sqrt((distX * distX) + (distY * distY));

    // If the distance is less than the radius, collision!
    if (distance <= rad) {
        return true;
    }
    return false;
}

module.exports = { circleRectCollision };