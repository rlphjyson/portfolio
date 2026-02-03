import { useState, useEffect } from 'react';
import { ExpandedImageModal } from './ExpandedImageModal';

export const Gallery = (props: GalleryProps) => {
    const { length: imgsUrlsLength } = props.imagesUrls
    const [currentIndex, setCurrentIndex] = useState(0)
    const [showFullSizeImage, setShowFullSizeImage] = useState(false)

    const handlePrevClick = () =>
        currentIndex <= 0
            ? setCurrentIndex(imgsUrlsLength - 1)
            : setCurrentIndex(currentIndex - 1)

    const handleNextClick = () =>
        currentIndex >= imgsUrlsLength - 1
            ? setCurrentIndex(0)
            : setCurrentIndex(currentIndex + 1)

    return (
        <ExpandedImageModal
            open={showFullSizeImage}
            src={props.imagesUrls[currentIndex]}
            onOpenChange={() => setShowFullSizeImage((current) => !current)}
        />
    )
}

export const UserScreen: React.FC<{ userId: string }> = ({ userId }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      const response = await fetch(`/api/users/${userId}`);
      const data = await response.json();
      setUser(data);
      setLoading(false);
    };
    fetchUser();
  }, [userId]);

  return loading ? <div>Loading...</div> : <div>{user.name}</div>;
};

