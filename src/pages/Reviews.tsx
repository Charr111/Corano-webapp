import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, query, where, or } from 'firebase/firestore';
import { db } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Review } from '../types';
import BackToTop from '../components/BackToTop';

const Reviews = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  
  // Form State
  const [author, setAuthor] = useState('');
  const [text, setText] = useState('');
  const [rating, setRating] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      // Due to Firebase security rules, we must explicitly filter for 'approved' or no status
      // Note: Firestore doesn't easily support querying for missing fields, 
      // but we will rely on the Admin side to approve reviews. We query all 
      // where status in ['approved']
      const q = query(collection(db, 'reviews'), where('status', '==', 'approved'));
      const snap = await getDocs(q);
      const revs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Review));
      
      const approvedRevs = revs;
      
      // Sort to push Rima issa and Eli Doueri to the end
      approvedRevs.sort((a, b) => {
        const aIsRimaOrEli = a.author === 'Rima issa' || a.author === 'Eli Doueri';
        const bIsRimaOrEli = b.author === 'Rima issa' || b.author === 'Eli Doueri';
        
        if (aIsRimaOrEli && !bIsRimaOrEli) return 1;
        if (!aIsRimaOrEli && bIsRimaOrEli) return -1;
        
        // If both are the target reviews, ensure Eli is after Rima or vice-versa
        // Let's just keep them relatively in whatever order they were, or hardcode it
        if (aIsRimaOrEli && bIsRimaOrEli) {
           if (a.author === 'Rima issa' && b.author === 'Eli Doueri') return -1;
           if (a.author === 'Eli Doueri' && b.author === 'Rima issa') return 1;
        }
        
        return 0;
      });
      
      setReviews(approvedRevs);
    } catch (error) {
      console.error("Error fetching reviews:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!author || !text) return;
    
    setSubmitting(true);
    setSubmitMessage('');
    try {
      const newReview: Omit<Review, 'id'> = {
        author,
        text,
        rating,
        date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        status: 'pending'
      };
      
      await addDoc(collection(db, 'reviews'), newReview);
      setSubmitMessage('Thank you! Your review has been submitted and is pending approval.');
      setAuthor('');
      setText('');
      setRating(5);
      setTimeout(() => {
        setShowForm(false);
        setSubmitMessage('');
      }, 4000);
    } catch (error: any) {
      console.error("Error submitting review:", error);
      setSubmitMessage('Error submitting review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-full pt-16 md:pt-0 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="relative min-h-full py-16 px-4 sm:px-6 lg:px-8">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img src="https://images.restocorano.com/items/site-reviews-bg.jpg" alt="Reviews Background" className="w-full h-full object-cover" fetchPriority="high" loading="eager" />
        <div className="absolute inset-0 bg-background/60"></div>
      </div>
      <div className="relative z-10 max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="font-headline text-4xl md:text-5xl text-primary mb-4">Customer Reviews</h1>
          <p className="font-headline text-xl text-on-surface-variant max-w-2xl mx-auto mb-8">
            Hear what our guests have to say about their experiences at Corano.
          </p>
          <button 
            onClick={() => setShowForm(true)}
            className="font-headline bg-primary text-on-primary px-8 py-3 rounded-full font-bold shadow-md hover:bg-primary/90 transition-colors"
          >
            Write a Review
          </button>
        </div>

        {reviews.length === 0 ? (
          <div className="text-center text-on-surface-variant py-12">
            No reviews yet. Check back later!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {reviews.map((review, idx) => (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                key={review.id}
                className="bg-surface-container-low p-8 rounded-3xl border border-outline-variant/30"
              >
                <div className="flex items-center mb-6">
                  {/* Stars */}
                  <div className="flex text-primary">
                    {[...Array(5)].map((_, i) => (
                      <span key={i} className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                        {i < review.rating ? 'star' : 'star_border'}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="font-headline text-on-surface text-lg leading-relaxed mb-6 italic">
                  "{review.text}"
                </p>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-primary">{review.author}</h4>
                    <span className="text-sm text-on-surface-variant">{review.date}</span>
                  </div>
                  <div className="w-12 h-12 bg-surface-container rounded-full flex items-center justify-center text-primary font-bold text-xl">
                    {review.author.charAt(0).toUpperCase()}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Review Modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface p-8 rounded-3xl w-full max-w-md relative"
            >
              <button 
                onClick={() => setShowForm(false)}
                className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-3xl">close</span>
              </button>
              
              <h2 className="text-2xl font-headline text-primary mb-6">Write a Review</h2>
              
              {submitMessage ? (
                <div className="bg-primary/20 text-primary p-4 rounded-xl text-center font-medium">
                  {submitMessage}
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-on-surface mb-1">Your Name</label>
                    <input 
                      required
                      type="text" 
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      className="w-full bg-surface-container border border-outline-variant rounded-xl p-3 text-on-surface focus:outline-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-on-surface mb-1">Rating</label>
                    <div className="flex gap-2 text-2xl">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          className={`material-symbols-outlined focus:outline-none transition-colors ${star <= rating ? 'text-primary' : 'text-on-surface-variant/30'}`}
                          style={{ fontVariationSettings: star <= rating ? "'FILL' 1" : "'FILL' 0" }}
                        >
                          star
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-on-surface mb-1">Your Review</label>
                    <textarea 
                      required
                      rows={4}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      className="w-full bg-surface-container border border-outline-variant rounded-xl p-3 text-on-surface focus:outline-primary resize-none"
                    ></textarea>
                  </div>
                  <button 
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Submitting...' : 'Submit Review'}
                  </button>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BackToTop />
    </div>
  );
};

export default Reviews;
